import * as THREE from 'three';

interface SmokeParticle {
  mesh:       THREE.Mesh;
  velocity:   THREE.Vector3;
  life:       number;
  maxLife:    number;
  maxOpacity: number;
}

interface SmokeEmitter {
  position:    THREE.Vector3;
  healthRatio: number;
  spawnTimer:  number;
}

export interface BulletTracer {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  speed: number;
  life: number;
  ownerId: string;
  damage: number;
}

export interface ExplosionEffect {
  group: THREE.Group;
  life: number;
  maxLife: number;
  particles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[];
}

export class EffectsManager {
  private scene: THREE.Scene;
  private tracers: BulletTracer[] = [];
  private explosions: ExplosionEffect[] = [];
  
  // Reusable materials
  private tracerMat: THREE.MeshBasicMaterial;
  private enemyTracerMat: THREE.MeshBasicMaterial;
  private fireMat: THREE.MeshBasicMaterial;
  private smokeMat: THREE.MeshBasicMaterial;
  
  // Object pool for bullet tracers
  private tracerPool: THREE.Mesh[] = [];
  private maxTracers = 100;

  // ── Smoke trail system ────────────────────────────────────────────────────
  /** Pool of pre-created meshes reused for smoke puffs. */
  private _smokePool:           THREE.Mesh[]   = [];
  private _activeSmokeParticles: SmokeParticle[] = [];
  /** Per-plane emitter state, keyed by plane id (e.g. 'player', 'ai_0'). */
  private _smokeEmitters = new Map<string, SmokeEmitter>();
  private readonly _MAX_SMOKE = 250;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffee00 }); // player — bright yellow
    this.fireMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    this.smokeMat = new THREE.MeshBasicMaterial({ 
      color: 0x555555, 
      transparent: true, 
      opacity: 0.6 
    });
    
    // Enemy tracers — distinct bright orange-red
    this.enemyTracerMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    
    // Pre-create tracer meshes — thinner and snappier
    const tracerGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5);
    tracerGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < this.maxTracers; i++) {
      const mesh = new THREE.Mesh(tracerGeo, this.tracerMat);
      mesh.visible = false;
      scene.add(mesh);
      this.tracerPool.push(mesh);
    }

    // Pre-create smoke puff pool — shared geometry, per-mesh material for opacity.  
    const smokeGeo = new THREE.SphereGeometry(0.5, 5, 5);
    for (let i = 0; i < this._MAX_SMOKE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite:  false,
        opacity:     0,
      });
      const mesh = new THREE.Mesh(smokeGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this._smokePool.push(mesh);
    }
  }

  // ── Smoke trail API ──────────────────────────────────────────────────────

  /**
   * Register or refresh a plane's smoke emitter.
   * Call every frame for each alive plane.
   * healthRatio = 1 → no smoke; 0 → maximum thick black smoke.
   */
  setPlaneSmoke(id: string, position: THREE.Vector3, healthRatio: number): void {
    let e = this._smokeEmitters.get(id);
    if (!e) {
      e = { position: position.clone(), healthRatio, spawnTimer: 0 };
      this._smokeEmitters.set(id, e);
    } else {
      e.position.copy(position);
      e.healthRatio = healthRatio;
    }
  }

  /** Remove a plane's emitter (call when it dies or despawns). */
  clearPlaneSmoke(id: string): void {
    this._smokeEmitters.delete(id);
  }
  
  spawnTracer(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    ownerId: string,
    damage: number
  ) {
    // Find an available tracer from pool
    const mesh = this.tracerPool.find(m => !m.visible);
    if (!mesh) return;
    
    mesh.visible = true;
    mesh.position.copy(position);
    mesh.lookAt(position.clone().add(direction));
    // Swap material based on owner so player and enemy bullets are visually distinct
    mesh.material = ownerId === 'player' ? this.tracerMat : this.enemyTracerMat;
    
    this.tracers.push({
      mesh,
      direction: direction.clone().normalize(),
      speed: 200,
      life: 0.5,
      ownerId,
      damage,
    });
  }
  
  spawnMuzzleFlash(position: THREE.Vector3) {
    const flashGeo = new THREE.SphereGeometry(0.02, 4, 4);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.7 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(position);
    this.scene.add(flash);
    
    // Remove after ~1 frame (20ms) — brief pop, not a persistent glow
    setTimeout(() => {
      this.scene.remove(flash);
      flashGeo.dispose();
      flashMat.dispose();
    }, 20);
  }
  
  spawnExplosion(position: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(position);
    
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[] = [];
    
    // Fire particles
    for (let i = 0; i < 20; i++) {
      const size = 0.1 + Math.random() * 0.4;
      const geo = new THREE.SphereGeometry(size, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ 
        color: Math.random() > 0.5 ? 0xff4400 : 0xffaa00,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 5,
        (Math.random() - 0.5) * 8
      );
      
      group.add(mesh);
      particles.push({ mesh, velocity });
    }
    
    // Smoke particles
    for (let i = 0; i < 15; i++) {
      const size = 0.2 + Math.random() * 0.6;
      const geo = new THREE.SphereGeometry(size, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ 
        color: 0x444444,
        transparent: true,
        opacity: 0.7,
      });
      const mesh = new THREE.Mesh(geo, mat);
      
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        1 + Math.random() * 3,
        (Math.random() - 0.5) * 3
      );
      
      group.add(mesh);
      particles.push({ mesh, velocity });
    }
    
    // Debris pieces
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BoxGeometry(
        0.06 + Math.random() * 0.16,
        0.02 + Math.random() * 0.06,
        0.06 + Math.random() * 0.16
      );
      const mat = new THREE.MeshLambertMaterial({ 
        color: 0x666666
      });
      const mesh = new THREE.Mesh(geo, mat);
      
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        Math.random() * 6,
        (Math.random() - 0.5) * 10
      );
      
      group.add(mesh);
      particles.push({ mesh, velocity });
    }
    
    this.scene.add(group);
    this.explosions.push({
      group,
      life: 2.0,
      maxLife: 2.0,
      particles,
    });
  }
  
  spawnDamageSmoke(position: THREE.Vector3) {
    // Smaller smoke puff for taking damage
    const geo = new THREE.SphereGeometry(0.16, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ 
      color: 0x333333, 
      transparent: true, 
      opacity: 0.5 
    });
    const smoke = new THREE.Mesh(geo, mat);
    smoke.position.copy(position);
    this.scene.add(smoke);
    
    const startTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed > 1) {
        this.scene.remove(smoke);
        geo.dispose();
        mat.dispose();
        return;
      }
      smoke.position.y += 0.02;
      smoke.scale.multiplyScalar(1.02);
      mat.opacity = 0.5 * (1 - elapsed);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
  
  update(dt: number): BulletTracer[] {
    // ── Smoke trail emitters ─────────────────────────────────────────────────
    for (const [, emitter] of this._smokeEmitters) {
      const damage = 1 - emitter.healthRatio; // 0 = healthy, 1 = destroyed
      if (damage <= 0.15) continue;           // no smoke under 15% damage

      // Spawn interval: 0.30s at 15% damage → 0.030s at 100% damage
      const t = Math.min(1, (damage - 0.15) / 0.85);
      const interval = 0.30 - t * 0.27;       // 0.30 → 0.03 s
      emitter.spawnTimer += dt;

      while (emitter.spawnTimer >= interval) {
        emitter.spawnTimer -= interval;
        const mesh = this._smokePool.find(m => !m.visible);
        if (!mesh) break;

        mesh.visible = true;
        mesh.position.copy(emitter.position);
        // Size: 0.5 m (light) → 1.0 m (heavy) radius sphere, grows over life
        const startScale = 1.0 + t * 1.0;
        mesh.scale.setScalar(startScale);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        // Color: light grey (0x999999) → near-black (0x111111) with damage
        const brightness = Math.round(0x99 - t * 0x88);
        mat.color.setRGB(brightness / 255, brightness / 255, brightness / 255);
        const maxOpacity = 0.25 + t * 0.55; // 0.25 (light) → 0.80 (heavy)
        mat.opacity = maxOpacity;

        this._activeSmokeParticles.push({
          mesh,
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            1.5 + Math.random() * 2.5,
            (Math.random() - 0.5) * 2,
          ),
          life:       1.2 + Math.random() * 0.8,
          maxLife:    2.0,
          maxOpacity,
        });
      }
    }

    // ── Active smoke particles ────────────────────────────────────────────────
    for (let i = this._activeSmokeParticles.length - 1; i >= 0; i--) {
      const p = this._activeSmokeParticles[i];
      p.life -= dt;

      if (p.life <= 0) {
        p.mesh.visible = false;
        this._activeSmokeParticles.splice(i, 1);
        continue;
      }

      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.multiplyScalar(0.96);               // drag / disperse
      p.mesh.scale.multiplyScalar(1 + dt * 0.9);     // expand as it rises
      (p.mesh.material as THREE.MeshBasicMaterial).opacity =
        p.maxOpacity * (p.life / p.maxLife);          // fade out
    }

    // Update tracers
    const activeTracers: BulletTracer[] = [];
    
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.life -= dt;
      
      if (tracer.life <= 0) {
        tracer.mesh.visible = false;
        this.tracers.splice(i, 1);
        continue;
      }
      
      // Move tracer
      tracer.mesh.position.addScaledVector(tracer.direction, tracer.speed * dt);
      activeTracers.push(tracer);
    }
    
    // Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i];
      exp.life -= dt;
      
      if (exp.life <= 0) {
        this.scene.remove(exp.group);
        // Dispose geometries
        for (const p of exp.particles) {
          p.mesh.geometry.dispose();
          (p.mesh.material as THREE.Material).dispose();
        }
        this.explosions.splice(i, 1);
        continue;
      }
      
      const lifeRatio = exp.life / exp.maxLife;
      
      for (const p of exp.particles) {
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.velocity.y -= 9.81 * dt; // gravity on debris
        p.velocity.multiplyScalar(0.98); // air resistance
        
        // Fade out
        const mat = p.mesh.material as THREE.MeshBasicMaterial;
        if (mat.transparent) {
          mat.opacity = lifeRatio * (mat.opacity > 0.3 ? 1 : 0.7);
        }
        
        // Scale up fire/smoke
        if (mat.color.r > 0.5) {
          p.mesh.scale.multiplyScalar(1 + dt * 2);
        }
      }
    }
    
    return activeTracers;
  }
}
