import * as THREE from 'three';
import { AircraftDef, InputState } from '../shared/types';
import { PHYSICS } from '../shared/constants';

const _forward = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _tempQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();

export class FlightPhysics {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  speed: number;
  throttle: number;
  velocity: THREE.Vector3;
  
  private aircraftDef: AircraftDef;
  
  constructor(def: AircraftDef, spawnPos: THREE.Vector3, spawnHeading: number = 0) {
    this.aircraftDef = def;
    this.position = spawnPos.clone();
    this.quaternion = new THREE.Quaternion();
    this.quaternion.setFromAxisAngle(_up, spawnHeading);
    this.speed = def.speedCruise;
    this.throttle = 0.5;
    this.velocity = new THREE.Vector3();
  }
  
  update(input: InputState, dt: number): void {
    const def = this.aircraftDef;
    
    // --- Throttle ---
    this.throttle = THREE.MathUtils.clamp(input.throttle, 0, 1);
    
    // Target speed based on throttle
    const targetSpeed = THREE.MathUtils.lerp(def.speedMin, def.speedMax, this.throttle);
    
    // Accelerate / decelerate toward target
    const speedDiff = targetSpeed - this.speed;
    this.speed += Math.sign(speedDiff) * Math.min(Math.abs(speedDiff), def.acceleration * dt);
    
    // Gravity effect: diving speeds up, climbing slows down
    const forward = this.getForward();
    const gravityEffect = -forward.y * PHYSICS.gravityEffect * 9.81 * dt;
    this.speed += gravityEffect;
    
    // Drag
    this.speed -= this.speed * PHYSICS.dragCoefficient * dt;
    
    // Clamp speed
    this.speed = THREE.MathUtils.clamp(this.speed, def.speedMin, def.speedMax * 1.2);
    
    // --- Rotation ---
    // Apply pitch (around local X axis)
    if (Math.abs(input.pitch) > 0.05) {
      _tempQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -input.pitch * def.pitchRate * dt);
      this.quaternion.multiply(_tempQuat);
    }
    
    // Apply yaw (around local Y axis)
    if (Math.abs(input.yaw) > 0.05) {
      _tempQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -input.yaw * def.yawRate * dt);
      this.quaternion.multiply(_tempQuat);
    }
    
    // Apply roll (around local Z axis)
    if (Math.abs(input.roll) > 0.05) {
      _tempQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -input.roll * def.rollRate * dt);
      this.quaternion.multiply(_tempQuat);
    }
    
    // Auto-level: gently return to level flight when no pitch/roll input
    if (Math.abs(input.pitch) < 0.05 && Math.abs(input.roll) < 0.05) {
      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      
      // Dampen pitch toward 0 (level)
      _euler.x *= (1 - PHYSICS.autoLevelStrength * dt);
      
      // Dampen roll toward 0
      _euler.z *= (1 - PHYSICS.autoLevelStrength * dt);
      
      this.quaternion.setFromEuler(_euler);
    }
    
    this.quaternion.normalize();
    
    // --- Position update ---
    this.velocity.copy(this.getForward()).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);
    
    // --- Altitude constraints ---
    if (this.position.y < PHYSICS.minAltitude) {
      this.position.y = PHYSICS.minAltitude;
      // Bounce upward slightly
      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      if (_euler.x > 0) { // if pointing downward
        _euler.x *= 0.5; // reduce pitch down
      }
      this.quaternion.setFromEuler(_euler);
    }
    
    if (this.position.y > PHYSICS.maxAltitude) {
      this.position.y = PHYSICS.maxAltitude;
      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      if (_euler.x < 0) { // if pointing upward
        _euler.x *= 0.5;
      }
      this.quaternion.setFromEuler(_euler);
    }
    
    // --- Map boundary (soft wrap) ---
    const maxDist = 450;
    const distFromCenter = Math.sqrt(this.position.x ** 2 + this.position.z ** 2);
    if (distFromCenter > maxDist) {
      // Progressively stronger push back toward center
      const overDist = distFromCenter - maxDist;
      const pushStrength = overDist * overDist * 0.0005 + overDist * 0.02;
      const toCenter = new THREE.Vector3(-this.position.x, 0, -this.position.z).normalize();
      this.position.addScaledVector(toCenter, pushStrength * this.speed * dt);
      
      // Also steer orientation toward center
      if (overDist > 20) {
        const fwd = this.getForward();
        const dotToCenter = fwd.dot(toCenter);
        if (dotToCenter < 0.5) {
          // Blend quaternion toward center-facing
          const targetQuat = new THREE.Quaternion();
          const lookMtx = new THREE.Matrix4().lookAt(
            this.position,
            new THREE.Vector3(0, this.position.y, 0),
            _up
          );
          targetQuat.setFromRotationMatrix(lookMtx);
          const blendFactor = Math.min(overDist * 0.005, 0.3) * dt * 3;
          this.quaternion.slerp(targetQuat, blendFactor);
        }
      }
    }
    
    // Hard boundary — never go beyond 600m
    if (distFromCenter > 600) {
      const norm = new THREE.Vector3(this.position.x, 0, this.position.z).normalize();
      this.position.x = norm.x * 600;
      this.position.z = norm.z * 600;
    }
  }
  
  getForward(): THREE.Vector3 {
    _forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    return _forward;
  }
  
  getRight(): THREE.Vector3 {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
  }
  
  getUp(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
  }
  
  // Get gun muzzle position (front of aircraft)
  getMuzzlePosition(): THREE.Vector3 {
    const fwd = this.getForward();
    return this.position.clone().addScaledVector(fwd, 5);
  }
  
  getAltitude(): number {
    return this.position.y;
  }
  
  getSpeedKmh(): number {
    return this.speed * 3.6; // m/s to km/h
  }
}
