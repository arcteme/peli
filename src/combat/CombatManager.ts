import * as THREE from 'three';
import { AircraftDef, AircraftId, InputState } from '../shared/types';
import { AIRCRAFT, AI_SPAWN_POINTS, PHYSICS } from '../shared/constants';

import { FlightPhysics } from '../physics/FlightPhysics';
import { createAircraftModel } from '../entities/AircraftModel';

interface AIPlane {
  id: string;
  physics: FlightPhysics;
  mesh: THREE.Group;
  health: number;
  maxHealth: number;
  alive: boolean;
  respawnTimer: number;
  aircraftDef: AircraftDef;
  // AI behavior
  targetId: string | null;
  behaviorTimer: number;
  behavior: 'patrol' | 'chase' | 'evade' | 'attack';
  patrolPoint: THREE.Vector3;
  patrolAngle: number;       // current angle around city center (radians)
  patrolRadius: number;      // orbit radius
  patrolAltitude: number;    // orbit altitude
  patrolDirection: number;   // +1 or -1 (CW vs CCW)
  lastFireTime: number;
}

const _tempVec = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();

export class CombatManager {
  private scene: THREE.Scene;
  public enemies: AIPlane[] = [];
  private nextId = 0;
  
  // Player state
  public playerHealth = 100;
  public playerMaxHealth = 100;
  public playerKills = 0;
  public playerDeaths = 0;
  public playerAlive = true;
  public playerRespawnTimer = 0;
  
  // Kill feed
  public killFeed: { text: string; time: number }[] = [];
  
  // Hit marker timer
  public hitMarkerTimer = 0;
  public damageIndicatorTimer = 0;
  
  // Only one AI attacks the player at a time
  private attackerId: string | null = null;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }
  
  spawnEnemies(count: number, buildingColliders: THREE.Box3[]) {
    const aircraftIds: AircraftId[] = ['zero', 'spitfire', 'bf109'];
    
    for (let i = 0; i < count; i++) {
      const aircraftId = aircraftIds[i % aircraftIds.length];
      const def = AIRCRAFT[aircraftId];
      // Spawn from opposite side of map to the player
      const spawn = AI_SPAWN_POINTS[i % AI_SPAWN_POINTS.length];
      
      const spawnPos = new THREE.Vector3(
        spawn.x + (Math.random() - 0.5) * 40,
        spawn.y,
        spawn.z + (Math.random() - 0.5) * 40
      );
      
      const heading = Math.atan2(-spawnPos.x, -spawnPos.z); // face center
      
      const physics = new FlightPhysics(def, spawnPos, heading);
      const mesh = createAircraftModel(def);
      mesh.position.copy(spawnPos);
      this.scene.add(mesh);
      
      // Evenly spaced starting angles, fixed distinct altitudes and radii for
      // clear individual paths that don't clog together around the centre.
      const patrolAngle = (i / count) * Math.PI * 2;
      const patrolRadius    = 120 + i * 35;         // 120, 155, 190, 225, 260, 295 m
      const patrolAltitude  =  45 + i * 22;         //  45,  67,  89, 111, 133, 155 m
      const patrolDirection = (i % 2 === 0) ? 1 : -1; // alternate CW / CCW
      
      const enemy: AIPlane = {
        id: `ai_${this.nextId++}`,
        physics,
        mesh,
        health: def.health,
        maxHealth: def.health,
        aircraftDef: def,
        alive: true,
        respawnTimer: 0,
        targetId: null,
        behaviorTimer: 0,
        behavior: 'patrol',
        patrolPoint: new THREE.Vector3(
          Math.cos(patrolAngle) * patrolRadius,
          patrolAltitude,
          Math.sin(patrolAngle) * patrolRadius
        ),
        patrolAngle,
        patrolRadius,
        patrolAltitude,
        patrolDirection,
        lastFireTime: 0,
      };
      
      this.enemies.push(enemy);
    }
  }
  
  update(
    dt: number,
    playerPosition: THREE.Vector3,
    playerQuaternion: THREE.Quaternion,
    playerAlive: boolean,
    buildingColliders: THREE.Box3[],
    now: number,
    onEnemyFire?: (position: THREE.Vector3, direction: THREE.Vector3, damage: number) => void,
    onEnemyKilled?: (position: THREE.Vector3) => void
  ) {
    // Update kill feed (remove old entries)
    this.killFeed = this.killFeed.filter(k => now - k.time < 5000);
    
    // Hit marker decay
    if (this.hitMarkerTimer > 0) this.hitMarkerTimer -= dt;
    if (this.damageIndicatorTimer > 0) this.damageIndicatorTimer -= dt;
    
    // Player respawn
    if (!this.playerAlive) {
      this.playerRespawnTimer -= dt;
      if (this.playerRespawnTimer <= 0) {
        this.playerAlive = true;
        this.playerHealth = this.playerMaxHealth;
      }
    }
    
    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        enemy.respawnTimer -= dt;
        if (enemy.respawnTimer <= 0) {
          this.respawnEnemy(enemy);
        }
        continue;
      }
      
      // Continuously advance patrol orbit (not just on decision tick)
      this.updatePatrolOrbit(enemy, dt);
      
      // AI decision making
      enemy.behaviorTimer -= dt;
      if (enemy.behaviorTimer <= 0) {
        this.decideAIBehavior(enemy, playerPosition, playerAlive);
        enemy.behaviorTimer = 1 + Math.random() * 2;
      }
      
      // Generate AI input (with building avoidance)
      const input = this.generateAIInput(enemy, playerPosition, playerAlive, now, buildingColliders);
      
      // Force AI back if too far from center
      const distFromCenter = Math.sqrt(
        enemy.physics.position.x ** 2 + enemy.physics.position.z ** 2
      );
      if (distFromCenter > 400) {
        // Override: steer back to center
        enemy.behavior = 'patrol';
        enemy.behaviorTimer = 0; // re-evaluate soon
      }
      
      // Update physics
      enemy.physics.update(input, dt);
      
      // Ground crash — if the plane reaches the altitude floor it has crashed
      if (enemy.physics.position.y <= PHYSICS.minAltitude + 0.2) {
        const pos = this.killEnemy(enemy, 'crashed into the ground', now);
        if (pos && onEnemyKilled) onEnemyKilled(pos);
        continue;
      }
      
      // Building collision
      if (this.checkBuildingCollision(enemy.physics.position, buildingColliders)) {
        const pos = this.killEnemy(enemy, 'crashed into a building', now);
        if (pos && onEnemyKilled) onEnemyKilled(pos);
        continue;
      }
      
      // Update mesh
      enemy.mesh.position.copy(enemy.physics.position);
      enemy.mesh.quaternion.copy(enemy.physics.quaternion);
      
      // Spin propeller
      const prop = enemy.mesh.getObjectByName('propeller');
      if (prop) prop.rotation.z += dt * 30;
      
      // Fire at player
      if (input.fire && enemy.alive && onEnemyFire) {
        const muzzle = enemy.physics.getMuzzlePosition();
        const fwd = enemy.physics.getForward();
        onEnemyFire(muzzle, fwd, enemy.aircraftDef.weaponDamage);
      }
    }
  }
  
  private updatePatrolOrbit(enemy: AIPlane, dt: number) {
    // Continuously advance the orbit angle
    const angularSpeed = enemy.aircraftDef.speedCruise / enemy.patrolRadius;
    enemy.patrolAngle += angularSpeed * enemy.patrolDirection * dt;
    
    enemy.patrolPoint.set(
      Math.cos(enemy.patrolAngle) * enemy.patrolRadius,
      enemy.patrolAltitude,
      Math.sin(enemy.patrolAngle) * enemy.patrolRadius
    );
  }
  
  private decideAIBehavior(enemy: AIPlane, playerPos: THREE.Vector3, playerAlive: boolean) {
    const distToPlayer = enemy.physics.position.distanceTo(playerPos);
    
    if (!playerAlive) {
      if (this.attackerId === enemy.id) this.attackerId = null;
      enemy.behavior = 'patrol';
      return;
    }
    
    if (distToPlayer < 150 && enemy.health < enemy.maxHealth * 0.3) {
      // Low health — break off attack
      if (this.attackerId === enemy.id) this.attackerId = null;
      enemy.behavior = 'evade';
    } else if (distToPlayer < 300) {
      // Only engage if no one else is already attacking
      const canAttack = this.attackerId === null || this.attackerId === enemy.id;
      if (canAttack && Math.random() > 0.3) {
        enemy.behavior = 'attack';
        this.attackerId = enemy.id;
      } else {
        // Others hang back and chase loosely — stay close but don't shoot
        if (this.attackerId === enemy.id) this.attackerId = null;
        enemy.behavior = 'chase';
      }
    } else {
      if (this.attackerId === enemy.id) this.attackerId = null;
      enemy.behavior = 'patrol';
    }
    
    // Tighten orbit if drifted too far
    if (enemy.behavior === 'patrol') {
      const distFromCenter = Math.sqrt(
        enemy.physics.position.x ** 2 + enemy.physics.position.z ** 2
      );
      if (distFromCenter > 350) {
        enemy.patrolRadius = Math.max(100, enemy.patrolRadius - 30);
        enemy.patrolAngle = Math.atan2(enemy.physics.position.z, enemy.physics.position.x);
      }
    }
  }
  
  private generateAIInput(enemy: AIPlane, playerPos: THREE.Vector3, playerAlive: boolean, now: number, buildingColliders?: THREE.Box3[]): InputState {
    const input: InputState = {
      pitch: 0,
      yaw: 0,
      roll: 0,
      throttle: 0.6,
      fire: false,
      toggleCamera: false,
    };
    
    let targetPoint: THREE.Vector3;
    
    switch (enemy.behavior) {
      case 'patrol':
        targetPoint = enemy.patrolPoint;
        input.throttle = 0.5;
        break;
      case 'chase':
        targetPoint = playerPos;
        input.throttle = 0.8;
        break;
      case 'attack':
        targetPoint = playerPos;
        input.throttle = 0.9;
        break;
      case 'evade':
        // Fly away from player but stay near city center
        // Pick a point roughly opposite to player, but clamped near center
        {
          const awayDir = enemy.physics.position.clone().sub(playerPos).normalize();
          const evadeTarget = awayDir.multiplyScalar(120).add(new THREE.Vector3(0, 0, 0));
          // Clamp within 250m of center
          const evadeDist = Math.sqrt(evadeTarget.x ** 2 + evadeTarget.z ** 2);
          if (evadeDist > 250) {
            evadeTarget.x *= 250 / evadeDist;
            evadeTarget.z *= 250 / evadeDist;
          }
          evadeTarget.y = 80 + Math.random() * 60;
          targetPoint = evadeTarget;
        }
        input.throttle = 1.0;
        break;
      default:
        targetPoint = enemy.patrolPoint;
    }
    
    // Calculate steering toward target
    _toTarget.copy(targetPoint).sub(enemy.physics.position).normalize();
    _forward.set(0, 0, 1).applyQuaternion(enemy.physics.quaternion);
    
    // Decompose into pitch and yaw components
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(enemy.physics.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(enemy.physics.quaternion);
    
    // Pitch: dot product of toTarget with local up
    const pitchDot = _toTarget.dot(up);
    input.pitch = -pitchDot * 2;
    
    // Yaw/Roll: dot product with local right
    const yawDot = _toTarget.dot(right);
    input.roll = -yawDot * 1.5;
    input.yaw = -yawDot * 0.5;
    
    // --- Building avoidance ---
    if (buildingColliders) {
      const pos = enemy.physics.position;
      const fwd = _forward.clone();
      const lookAhead = 30 + enemy.physics.speed * 0.3; // look further at higher speed
      const avoidance = new THREE.Vector3();
      let needsAvoid = false;
      
      // Check ahead and slightly to the sides
      for (const offset of [
        fwd.clone().multiplyScalar(lookAhead),
        fwd.clone().multiplyScalar(lookAhead).add(new THREE.Vector3(1, 0, 0).applyQuaternion(enemy.physics.quaternion).multiplyScalar(8)),
        fwd.clone().multiplyScalar(lookAhead).add(new THREE.Vector3(-1, 0, 0).applyQuaternion(enemy.physics.quaternion).multiplyScalar(8)),
      ]) {
        const testPos = pos.clone().add(offset);
        for (const collider of buildingColliders) {
          const closest = new THREE.Vector3();
          collider.clampPoint(testPos, closest);
          const dist = testPos.distanceTo(closest);
          if (dist < 15) {
            // Push away from this building
            const away = testPos.clone().sub(closest).normalize();
            const urgency = (15 - dist) / 15;
            avoidance.add(away.multiplyScalar(urgency * 2));
            needsAvoid = true;
          }
        }
      }
      
      if (needsAvoid) {
        // Steer upward and away from buildings
        avoidance.y = Math.max(avoidance.y, 1.0); // always prefer climbing
        avoidance.normalize();
        
        const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(enemy.physics.quaternion);
        const upDir = new THREE.Vector3(0, 1, 0).applyQuaternion(enemy.physics.quaternion);
        
        const avoidPitch = -avoidance.dot(upDir) * 3;
        const avoidRoll = -avoidance.dot(rightDir) * 2;
        
        // Blend avoidance in heavily (override normal steering)
        input.pitch = input.pitch * 0.3 + avoidPitch * 0.7;
        input.roll = input.roll * 0.3 + avoidRoll * 0.7;
        input.yaw *= 0.3;
      }
      
      // Ensure minimum altitude — pitch up if getting dangerously low
      if (pos.y < 25) {
        const urgency = Math.max(0, (25 - pos.y) / 25);
        input.pitch = Math.min(input.pitch, -urgency); // pitch up (negative = up)
        input.throttle = Math.min(1, input.throttle + urgency * 0.4);
      }
    }
    
    // Clamp
    input.pitch = Math.max(-1, Math.min(1, input.pitch));
    input.yaw = Math.max(-1, Math.min(1, input.yaw));
    input.roll = Math.max(-1, Math.min(1, input.roll));
    
    // Fire when attacking and roughly aimed at player
    // Lower threshold (0.88) gives a wider burst window, but spread in callers
    // makes individual shots inaccurate — lousy-gunner feel.
    if (enemy.behavior === 'attack' && playerAlive) {
      const aimDot = _forward.dot(_toTarget);
      const distToPlayer = enemy.physics.position.distanceTo(playerPos);
      
      if (aimDot > 0.88 && distToPlayer < enemy.aircraftDef.weaponRange) {
        const fireInterval = 1 / enemy.aircraftDef.weaponFireRate;
        if (now - enemy.lastFireTime > fireInterval * 1000) {
          input.fire = true;
          enemy.lastFireTime = now;
        }
      }
    }
    
    return input;
  }
  
  private checkBuildingCollision(position: THREE.Vector3, colliders: THREE.Box3[]): boolean {
    const playerBox = new THREE.Box3().setFromCenterAndSize(
      position,
      new THREE.Vector3(0.8, 0.4, 0.8)
    );
    
    for (const collider of colliders) {
      if (playerBox.intersectsBox(collider)) {
        return true;
      }
    }
    return false;
  }
  
  private killEnemy(enemy: AIPlane, cause: string, now?: number) {
    const deathPos = enemy.physics.position.clone();
    enemy.alive = false;
    enemy.respawnTimer = 3;
    enemy.mesh.visible = false;
    // Release attacker lock so another plane can engage
    if (this.attackerId === enemy.id) this.attackerId = null;
    
    if (now !== undefined) {
      this.killFeed.push({
        text: `${enemy.aircraftDef.name} ${cause}`,
        time: now,
      });
    }
    
    return deathPos;
  }
  
  private respawnEnemy(enemy: AIPlane) {
    const spawn = AI_SPAWN_POINTS[Math.floor(Math.random() * AI_SPAWN_POINTS.length)];
    enemy.physics.position.set(
      spawn.x + (Math.random() - 0.5) * 40,
      spawn.y,
      spawn.z + (Math.random() - 0.5) * 40
    );
    const heading = Math.atan2(-enemy.physics.position.x, -enemy.physics.position.z);
    enemy.physics.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    enemy.physics.speed = enemy.aircraftDef.speedCruise;
    enemy.health = enemy.maxHealth;
    enemy.alive = true;
    enemy.mesh.visible = true;
    enemy.behavior = 'patrol';
    // Also release attacker lock on respawn
    if (this.attackerId === enemy.id) this.attackerId = null;
    // Reset orbit: start circling from current position
    enemy.patrolAngle = Math.atan2(enemy.physics.position.z, enemy.physics.position.x);
    enemy.patrolRadius = 150 + Math.random() * 200;
    enemy.patrolAltitude = 50 + Math.random() * 80;
  }
  
  // Check if any tracer hits an enemy
  checkTracerHits(
    tracerPos: THREE.Vector3,
    tracerOwnerId: string,
    damage: number,
    onHit: (enemy: AIPlane, position: THREE.Vector3) => void
  ): boolean {
    if (tracerOwnerId === 'player') {
      // Player tracer - check against enemies
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const dist = tracerPos.distanceTo(enemy.physics.position);
        if (dist < 5) { // hit radius
          enemy.health -= damage;
          this.hitMarkerTimer = 0.3;
          
          if (enemy.health <= 0) {
            const deathPos = this.killEnemy(enemy, 'shot down', performance.now());
            if (deathPos) onHit(enemy, deathPos);
            this.playerKills++;
            this.killFeed.push({
              text: `You shot down ${enemy.aircraftDef.name}`,
              time: performance.now(),
            });
          }
          return true;
        }
      }
    } else {
      // Enemy tracer - check against player
      // (handled in main game loop)
    }
    return false;
  }
  
  // Check enemy tracers hitting player
  checkPlayerHit(tracerPos: THREE.Vector3, playerPos: THREE.Vector3, damage: number): boolean {
    if (!this.playerAlive) return false;
    
    const dist = tracerPos.distanceTo(playerPos);
    if (dist < 5) {
      this.playerHealth -= damage;
      this.damageIndicatorTimer = 0.4;
      
      if (this.playerHealth <= 0) {
        this.playerAlive = false;
        this.playerDeaths++;
        this.playerRespawnTimer = 3;
        this.killFeed.push({
          text: 'You were shot down!',
          time: performance.now(),
        });
      }
      return true;
    }
    return false;
  }
  
  killPlayer() {
    if (!this.playerAlive) return;
    this.playerAlive = false;
    this.playerDeaths++;
    this.playerRespawnTimer = 3;
    this.playerHealth = 0;
    this.killFeed.push({
      text: 'You crashed!',
      time: performance.now(),
    });
  }
  
  resetPlayer(maxHealth: number) {
    this.playerHealth = maxHealth;
    this.playerMaxHealth = maxHealth;
    this.playerAlive = true;
  }
}
