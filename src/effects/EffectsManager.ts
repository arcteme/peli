import * as THREE from 'three';

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
  private fireMat: THREE.MeshBasicMaterial;
  private smokeMat: THREE.MeshBasicMaterial;
  
  // Object pool
  private tracerPool: THREE.Mesh[] = [];
  private maxTracers = 100;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
    this.fireMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    this.smokeMat = new THREE.MeshBasicMaterial({ 
      color: 0x555555, 
      transparent: true, 
      opacity: 0.6 
    });
    
    // Pre-create tracer meshes (scaled for 1:10 model aircraft)
    const tracerGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4);
    tracerGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < this.maxTracers; i++) {
      const mesh = new THREE.Mesh(tracerGeo, this.tracerMat);
      mesh.visible = false;
      scene.add(mesh);
      this.tracerPool.push(mesh);
    }
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
    
    this.tracers.push({
      mesh,
      direction: direction.clone().normalize(),
      speed: 50,
      life: 2.0,
      ownerId,
      damage,
    });
  }
  
  spawnMuzzleFlash(position: THREE.Vector3) {
    const flashGeo = new THREE.SphereGeometry(0.05, 4, 4);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(position);
    this.scene.add(flash);
    
    // Remove after 1 frame (50ms)
    setTimeout(() => {
      this.scene.remove(flash);
      flashGeo.dispose();
      flashMat.dispose();
    }, 50);
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
