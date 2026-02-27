import * as THREE from 'three';
import { AircraftId } from '../shared/types';
import { AIRCRAFT, SPAWN_POINTS, PHYSICS } from '../shared/constants';
import { FlightPhysics } from '../physics/FlightPhysics';
import { CameraManager } from '../camera/CameraManager';
import { InputManager } from '../input/InputManager';
import { CityMap } from '../world/CityMap';
import { Sky } from '../world/Sky';
import { createAircraftModel, createCockpitInterior } from '../entities/AircraftModel';
import { EffectsManager } from '../effects/EffectsManager';
import { AudioManager } from '../audio/AudioManager';
import { CombatManager } from '../combat/CombatManager';
import { HUD } from '../ui/HUD';
import { TextureCalibrator } from '../dev/TextureCalibrator';

export class Game {
  // Core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraManager: CameraManager;
  private inputManager: InputManager;
  private audioManager: AudioManager;
  
  // World
  private cityMap: CityMap;
  private sky: Sky;
  
  // Player
  private playerPhysics!: FlightPhysics;
  private playerMesh!: THREE.Group;
  private playerAircraftId!: AircraftId;
  private playerName = 'Pilot';
  private cockpitInterior!: THREE.Group;
  
  // Systems
  private effects: EffectsManager;
  private combat: CombatManager;
  private hud: HUD;
  
  // Timing
  private clock = new THREE.Clock();
  private lastFireTime = 0;
  
  // State
  private running = false;
  private audioInitialized = false;

  // Texture-alignment calibration tool (F4 to toggle)
  private calibrator!: TextureCalibrator;

  // Free-fly inspector mode (F3 to toggle)
  private inspectorMode = false;
  private inspectorYaw   = 0;
  private inspectorPitch = -0.25;
  private inspectorPos   = new THREE.Vector3(0, 80, 150);
  
  constructor(canvas: HTMLCanvasElement) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    
    // Scene
    this.scene = new THREE.Scene();
    
    // Camera
    this.cameraManager = new CameraManager(window.innerWidth / window.innerHeight);
    
    // Input
    this.inputManager = new InputManager(canvas);
    
    // Audio
    this.audioManager = new AudioManager(this.cameraManager.camera);
    
    // World
    this.cityMap = new CityMap();
    this.scene.add(this.cityMap.group);

    this.sky = new Sky(this.scene);
    this.scene.add(this.sky.group);

    // Dev calibration tool — created here so it can inject its fill mesh into the scene
    this.calibrator = new TextureCalibrator(this.scene, this.cityMap, this.sky);
    
    // Effects
    this.effects = new EffectsManager(this.scene);
    
    // Combat
    this.combat = new CombatManager(this.scene);
    
    // HUD
    this.hud = new HUD();
    this.hud.hide();
    
    // Resize handling
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cameraManager.resize(window.innerWidth / window.innerHeight);
    });

    // Inspector mode toggle (F3) — dev fly-camera
    // Calibration tool toggle (F4) — texture alignment
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        // Exit calibration if it was active when F3 is pressed
        if (this.calibrator.isActive()) this.calibrator.deactivate();
        this.inspectorMode = !this.inspectorMode;
        if (this.inspectorMode) {
          this.inspectorPos.copy(this.cameraManager.camera.position);
          const euler = new THREE.Euler().setFromQuaternion(this.cameraManager.camera.quaternion, 'YXZ');
          this.inspectorYaw   = euler.y;
          this.inspectorPitch = euler.x;
          this.hud.showMessage('Inspector mode ON — WASD fly, Shift=fast, F3 exit', 3000);
        } else {
          this.hud.showMessage('Inspector mode OFF', 1500);
        }
      }

      if (e.code === 'F4') {
        e.preventDefault();
        if (this.calibrator.isActive()) {
          this.calibrator.deactivate();
          this.hud.showMessage('Texture calibrator OFF', 1500);
        } else {
          // Exit inspector if active so the two dev modes don\'t overlap
          if (this.inspectorMode) {
            this.inspectorMode = false;
            this.hud.showMessage('', 0);
          }
          this.calibrator.activate();
          this.hud.showMessage('Texture calibrator ON — Arrow keys to move, F4 to exit', 3000);
        }
      }
    });
  }
  
  async start(aircraftId: AircraftId, playerName: string) {
    this.playerAircraftId = aircraftId;
    this.playerName = playerName;

    // Load real Kerava geometry from pre-processed GML binary files
    await this.cityMap.load();
    const def = AIRCRAFT[aircraftId];
    
    // Spawn player
    const spawn = SPAWN_POINTS[0];
    const spawnPos = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    const heading = Math.atan2(-spawn.x, -spawn.z);
    
    this.playerPhysics = new FlightPhysics(def, spawnPos, heading);
    
    // Create player aircraft mesh
    this.playerMesh = createAircraftModel(def);
    this.playerMesh.name = 'player-aircraft';
    this.scene.add(this.playerMesh);
    
    // Cockpit interior
    this.cockpitInterior = createCockpitInterior(def);
    this.cockpitInterior.visible = false;
    this.scene.add(this.cockpitInterior);
    this.cameraManager.cockpitInterior = this.cockpitInterior;
    
    // Spawn AI enemies
    this.combat.spawnEnemies(6, this.cityMap.colliders);
    this.combat.resetPlayer(def.health);
    
    // Start HUD
    this.hud.show();
    this.hud.showMessage(`Flying ${def.name} — Click to enable mouse control`, 4000);
    
    // Start game loop
    this.running = true;
    this.clock.start();
    this.gameLoop();
  }
  
  private async ensureAudio() {
    if (!this.audioInitialized) {
      await this.audioManager.init();
      this.audioInitialized = true;
    }
  }

  /** Free-fly camera for development inspection of the city. Toggle with F3. */
  private _updateInspector(dt: number) {
    const mouse = this.inputManager.consumeMouseDelta();
    this.inspectorYaw   -= mouse.x * 0.003;
    this.inspectorPitch  = Math.max(
      -Math.PI * 0.49, Math.min(Math.PI * 0.49,
      this.inspectorPitch - mouse.y * 0.003));

    const camQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.inspectorPitch, this.inspectorYaw, 0, 'YXZ'));

    const fast  = this.inputManager.isKeyDown('ShiftLeft') || this.inputManager.isKeyDown('ShiftRight');
    const speed = fast ? 120 : 20;
    const fwd   = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);

    if (this.inputManager.isKeyDown('KeyW') || this.inputManager.isKeyDown('ArrowUp'))
      this.inspectorPos.addScaledVector(fwd,   speed * dt);
    if (this.inputManager.isKeyDown('KeyS') || this.inputManager.isKeyDown('ArrowDown'))
      this.inspectorPos.addScaledVector(fwd,  -speed * dt);
    if (this.inputManager.isKeyDown('KeyA') || this.inputManager.isKeyDown('ArrowLeft'))
      this.inspectorPos.addScaledVector(right, -speed * dt);
    if (this.inputManager.isKeyDown('KeyD') || this.inputManager.isKeyDown('ArrowRight'))
      this.inspectorPos.addScaledVector(right,  speed * dt);
    if (this.inputManager.isKeyDown('Space') || this.inputManager.isKeyDown('KeyQ'))
      this.inspectorPos.y += speed * dt;
    if (this.inputManager.isKeyDown('ControlLeft') || this.inputManager.isKeyDown('KeyE'))
      this.inspectorPos.y -= speed * dt;

    this.cameraManager.camera.position.copy(this.inspectorPos);
    this.cameraManager.camera.quaternion.copy(camQuat);
  }
  
  private gameLoop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.gameLoop);
    
    const dt = Math.min(this.clock.getDelta(), 0.05); // Cap delta time
    const now = performance.now();
    
    this.update(dt, now);
    this.render();
  };
  
  private update(dt: number, now: number) {
    // --- Texture calibrator (F4) — suspends the normal game loop ---
    if (this.calibrator.isActive()) return;

    // --- Inspector (free-fly dev camera) ---
    if (this.inspectorMode) {
      this._updateInspector(dt);
      return;
    }

    const def = AIRCRAFT[this.playerAircraftId];
    
    // --- Input ---
    const input = this.inputManager.getInput();
    
    // Init audio on first user interaction (browser policy)
    if (input.fire || input.throttle > 0.1) {
      this.ensureAudio();
    }
    
    // Toggle camera
    if (input.toggleCamera) {
      this.cameraManager.toggleMode();
      this.hud.showMessage(
        this.cameraManager.mode === 'cockpit' ? 'Cockpit View' : 'Chase View', 
        1500
      );
    }
    
    // Invert pitch/roll in cockpit view so controls feel natural from inside
    if (this.cameraManager.mode === 'cockpit') {
      input.pitch = -input.pitch;
      input.roll = -input.roll;
    }
    
    // --- Player Physics ---
    if (this.combat.playerAlive) {
      this.playerPhysics.update(input, dt);
      
      // Building collision
      if (this.cityMap.checkCollision(this.playerPhysics.position, 0.5)) {
        this.combat.killPlayer();
        this.effects.spawnExplosion(this.playerPhysics.position.clone());
        this.audioManager.playExplosion();
        // Respawn position
        const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
        this.playerPhysics.position.set(spawn.x, spawn.y, spawn.z);
        this.playerPhysics.speed = def.speedCruise;
        const heading = Math.atan2(-spawn.x, -spawn.z);
        this.playerPhysics.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      }
      
      // Near-miss effect
      const nearDist = this.cityMap.getNearestBuildingDistance(this.playerPhysics.position);
      if (nearDist < PHYSICS.nearMissDistance && nearDist > 0) {
        const intensity = (1 - nearDist / PHYSICS.nearMissDistance) * 0.5;
        this.cameraManager.addShake(intensity);
      }
      
      // Firing
      if (input.fire && this.combat.playerAlive) {
        const fireInterval = 1000 / def.weaponFireRate;
        if (now - this.lastFireTime > fireInterval) {
          this.lastFireTime = now;
          
          const muzzlePos = this.playerPhysics.getMuzzlePosition();
          const fireDir = this.playerPhysics.getForward();
          
          // Add slight spread
          fireDir.x += (Math.random() - 0.5) * 0.02;
          fireDir.y += (Math.random() - 0.5) * 0.02;
          fireDir.z += (Math.random() - 0.5) * 0.02;
          fireDir.normalize();
          
          this.effects.spawnTracer(muzzlePos, fireDir, 'player', def.weaponDamage);
          this.effects.spawnMuzzleFlash(muzzlePos);
          this.audioManager.playGunshot();
        }
      }
      
      // Update player mesh
      this.playerMesh.position.copy(this.playerPhysics.position);
      this.playerMesh.quaternion.copy(this.playerPhysics.quaternion);
      this.playerMesh.visible = this.cameraManager.mode === 'chase';
      
      // Spin propeller
      const prop = this.playerMesh.getObjectByName('propeller');
      if (prop) prop.rotation.z += dt * 30;
      
      // Update cockpit interior position
      this.cockpitInterior.position.copy(this.playerPhysics.position);
      this.cockpitInterior.quaternion.copy(this.playerPhysics.quaternion);
    } else {
      // While dead, hide player
      this.playerMesh.visible = false;
      
      // When respawn happens
      if (this.combat.playerAlive) {
        const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
        this.playerPhysics.position.set(spawn.x, spawn.y, spawn.z);
        this.playerPhysics.speed = def.speedCruise;
        this.inputManager.setThrottle(0.5);
        const heading = Math.atan2(-spawn.x, -spawn.z);
        this.playerPhysics.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
        this.playerMesh.visible = true;
        this.hud.showMessage('Respawned!', 2000);
      }
    }
    
    // --- AI Enemies ---
    this.combat.update(
      dt,
      this.playerPhysics.position,
      this.playerPhysics.quaternion,
      this.combat.playerAlive,
      this.cityMap.colliders,
      now,
      (position, direction, damage) => {
        // Enemy fires a bullet
        this.effects.spawnTracer(position, direction, 'enemy', damage);
      }
    );
    
    // --- Effects / Bullet collisions ---
    const activeTracers = this.effects.update(dt);
    
    for (const tracer of activeTracers) {
      if (tracer.ownerId === 'player') {
        // Check player bullets hitting enemies
        this.combat.checkTracerHits(
          tracer.mesh.position,
          'player',
          tracer.damage,
          (enemy, position) => {
            this.effects.spawnExplosion(position);
            this.audioManager.playExplosion();
          }
        );
      } else {
        // Check enemy bullets hitting player
        if (this.combat.checkPlayerHit(
          tracer.mesh.position,
          this.playerPhysics.position,
          tracer.damage
        )) {
          this.cameraManager.addShake(0.5);
          this.audioManager.playDamageHit();
          this.effects.spawnDamageSmoke(this.playerPhysics.position.clone());
          
          if (!this.combat.playerAlive) {
            this.effects.spawnExplosion(this.playerPhysics.position.clone());
            this.audioManager.playExplosion();
          }
        }
      }
      
      // Check bullets hitting buildings
      if (this.cityMap.checkCollision(tracer.mesh.position, 0.5)) {
        tracer.life = 0; // destroy bullet
      }
    }
    
    // --- Audio ---
    this.audioManager.updateEngine(
      this.playerPhysics.throttle,
      this.playerPhysics.speed,
      def.speedMax
    );
    
    // --- Camera ---
    this.cameraManager.update(
      this.playerPhysics.position,
      this.playerPhysics.quaternion,
      this.playerPhysics.velocity,
      dt,
      this.cityMap.colliders
    );
    
    // --- HUD ---
    const euler = new THREE.Euler().setFromQuaternion(this.playerPhysics.quaternion, 'YXZ');
    
    this.hud.update({
      speed: this.playerPhysics.getSpeedKmh(),
      altitude: this.playerPhysics.getAltitude(),
      health: this.combat.playerHealth,
      maxHealth: this.combat.playerMaxHealth,
      throttle: this.playerPhysics.throttle,
      kills: this.combat.playerKills,
      deaths: this.combat.playerDeaths,
      alive: this.combat.playerAlive,
      respawnTimer: this.combat.playerRespawnTimer,
      hitMarker: this.combat.hitMarkerTimer > 0,
      damageIndicator: this.combat.damageIndicatorTimer > 0,
      killFeed: this.combat.killFeed,
      playerPos: { x: this.playerPhysics.position.x, z: this.playerPhysics.position.z },
      playerHeading: euler.y,
      enemies: this.combat.enemies.map(e => ({
        x: e.physics.position.x,
        z: e.physics.position.z,
        alive: e.alive,
      })),
      cameraMode: this.cameraManager.mode,
    });
  }
  
  private render() {
    if (this.calibrator.isActive()) {
      this.calibrator.render(this.renderer);
    } else {
      this.renderer.render(this.scene, this.cameraManager.camera);
    }
  }
  
  dispose() {
    this.running = false;
    this.renderer.dispose();
  }
}
