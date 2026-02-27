import * as THREE from 'three';
import { AircraftDef, InputState } from '../shared/types';
import { PHYSICS } from '../shared/constants';

const _forward  = new THREE.Vector3();
const _up       = new THREE.Vector3(0, 1, 0);
const _tempQuat = new THREE.Quaternion();
const _euler    = new THREE.Euler();
// Reusable rotation axes — avoids per-frame heap allocations
const _axisX    = new THREE.Vector3(1, 0, 0);
const _axisY    = new THREE.Vector3(0, 1, 0);
const _axisZ    = new THREE.Vector3(0, 0, 1);

export class FlightPhysics {
  position:   THREE.Vector3;
  quaternion: THREE.Quaternion;
  speed:      number;
  throttle:   number;
  velocity:   THREE.Vector3;

  /** True when airspeed is below stall — used by HUD to show warning. */
  isStalling = false;

  private aircraftDef: AircraftDef;

  // Stall speed: the minimum airspeed that generates enough lift.
  // Set at 110% of the aircraft's speedMin so there's a small margin.
  private get stallSpeed() { return this.aircraftDef.speedMin * 1.1; }

  constructor(def: AircraftDef, spawnPos: THREE.Vector3, spawnHeading = 0) {
    this.aircraftDef = def;
    this.position    = spawnPos.clone();
    this.quaternion  = new THREE.Quaternion();
    this.quaternion.setFromAxisAngle(_up, spawnHeading);
    this.speed    = def.speedCruise;
    this.throttle = 0.5;
    this.velocity = new THREE.Vector3();
  }

  update(input: InputState, dt: number): void {
    const def = this.aircraftDef;

    // ── 1. Throttle & engine thrust ──────────────────────────────────────────
    // Throttle contributes forward thrust each frame — NOT a target-speed governor.
    // Gravity (step 2) and drag (step 3) are free to change speed independently,
    // so diving / climbing produce real speed changes the pilot can feel.
    this.throttle = THREE.MathUtils.clamp(input.throttle, 0, 1);
    this.speed += this.throttle * def.acceleration * dt;

    // ── 2. Gravity / energy exchange ──────────────────────────────────────
    // Diving gains speed, climbing bleeds it.
    const fwd          = this.getForward();
    const pitchAngle   = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)); // + = nose up
    const gravityDelta = -Math.sin(pitchAngle) * 9.81 * PHYSICS.gravityEffect * dt;
    this.speed += gravityDelta;

    // ── 3. Drag ────────────────────────────────────────────────────────────
    // Pure quadratic drag — calibrated so 50 % throttle ≈ equilibrium at cruise speed:
    //   thrust(0.5) = 0.5 × acc ≈ dragCoeff × cruise²
    //   → dragCoeff ≈ 0.5 × acc / cruise²  (≈ 0.0085 for all three aircraft)
    const drag = PHYSICS.dragCoefficient * this.speed * this.speed * dt;
    this.speed -= drag;

    // Clamp
    this.speed = THREE.MathUtils.clamp(this.speed, 0, def.speedMax * 1.25);

    // ── 4. Stall detection ─────────────────────────────────────────────────
    this.isStalling = this.speed < this.stallSpeed;

    // ── 5. Speed-dependent control authority ──────────────────────────────
    // Controls are most effective around cruise speed.
    // Below stall: drastically reduced (0–0.15 range).
    // Above cruise: authority drops slightly (high speed = wide turn radius).
    const optSpeed = def.speedCruise;
    let authority: number;
    if (this.isStalling) {
      // 0 at 0 speed, 0.15 at stall speed — controls barely work
      authority = THREE.MathUtils.clamp(this.speed / this.stallSpeed * 0.15, 0, 0.15);
    } else {
      // Ramps from 0.15 at stall to 1.0 at cruise, then slightly reduces at high speed
      const aboveStall = (this.speed - this.stallSpeed) / (optSpeed - this.stallSpeed);
      authority = THREE.MathUtils.clamp(0.15 + aboveStall * 0.85, 0.15, 1.1);
      // Small high-speed penalty: fast plane needs more radius to turn
      if (this.speed > optSpeed) {
        const excess = (this.speed - optSpeed) / (def.speedMax - optSpeed + 0.001);
        authority *= 1 - excess * 0.3;
      }
    }

    // ── 6. Rotation ────────────────────────────────────────────────────────
    const effPitch = input.pitch * authority;
    const effRoll  = input.roll  * authority;
    const effYaw   = input.yaw   * authority;

    if (Math.abs(effPitch) > 0.01) {
      _tempQuat.setFromAxisAngle(_axisX, -effPitch * def.pitchRate * dt);
      this.quaternion.multiply(_tempQuat);
    }
    if (Math.abs(effYaw) > 0.01) {
      _tempQuat.setFromAxisAngle(_axisY, -effYaw * def.yawRate * dt);
      this.quaternion.multiply(_tempQuat);
    }
    if (Math.abs(effRoll) > 0.01) {
      _tempQuat.setFromAxisAngle(_axisZ, -effRoll * def.rollRate * dt);
      this.quaternion.multiply(_tempQuat);
    }

    // ── 7. Stall: nose drops, controls ineffective ─────────────────────────
    if (this.isStalling) {
      // Gravity pulls the nose toward vertical — stronger the slower we go
      const stallSeverity = THREE.MathUtils.clamp(
        1 - this.speed / this.stallSpeed, 0, 1
      );
      _tempQuat.setFromAxisAngle(_axisX, stallSeverity * 1.5 * dt);
      this.quaternion.multiply(_tempQuat);
    }

    // ── 8. Gravity in bank ─────────────────────────────────────────────────
    // When rolled, the lift vector tilts; without corrective pull the plane
    // loses altitude (just like real aircraft).
    _euler.setFromQuaternion(this.quaternion, 'ZYX');
    const bankAngle  = _euler.z;                        // roll angle
    const liftFactor = Math.cos(bankAngle);             // 0 in knife-edge, 1 level
    const sinkRate   = (1 - liftFactor) * 4 * dt;      // gentle descent in bank
    this.position.y -= sinkRate * (this.speed / def.speedCruise);

    // ── 9. Auto-level (weak — keeps it flyable but not too assist-heavy) ──
    if (Math.abs(input.pitch) < 0.05 && Math.abs(input.roll) < 0.05 && !this.isStalling) {
      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      // Weaker than before so momentum feels real
      const levelStr = PHYSICS.autoLevelStrength * 0.6;
      _euler.x *= (1 - levelStr * dt);
      _euler.z *= (1 - levelStr * dt);
      this.quaternion.setFromEuler(_euler);
    }

    this.quaternion.normalize();

    // ── 10. Velocity momentum ──────────────────────────────────────────────
    // True flight path lags slightly behind the nose direction, giving a
    // sense of inertia/momentum.  Blend weight: fast = tight tracking,
    // slow/stall = loose (plane carries its old direction for a moment).
    const trackingRate = this.isStalling
      ? 1.5            // stall: velocity barely follows the nose
      : THREE.MathUtils.lerp(3.0, 8.0, THREE.MathUtils.clamp(
          (this.speed - this.stallSpeed) / (def.speedMax - this.stallSpeed), 0, 1
        ));

    const desiredVelocity = this.getForward().clone().multiplyScalar(this.speed);
    this.velocity.lerp(desiredVelocity, Math.min(trackingRate * dt, 1));

    // Preserve the actual airspeed magnitude after lerp
    this.velocity.normalize().multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    // ── 11. Altitude floor (crash handled externally) ─────────────────────
    if (this.position.y < -10) this.position.y = -10;

    // ── 12. Altitude ceiling ──────────────────────────────────────────────
    if (this.position.y > PHYSICS.maxAltitude) {
      this.position.y = PHYSICS.maxAltitude;
      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      if (_euler.x < 0) _euler.x *= 0.5;
      this.quaternion.setFromEuler(_euler);
    }

    // ── 13. Map boundary (soft push back toward center) ───────────────────
    const distFromCenter = Math.sqrt(this.position.x ** 2 + this.position.z ** 2);
    if (distFromCenter > 450) {
      const overDist    = distFromCenter - 450;
      const pushStrength = overDist * overDist * 0.0005 + overDist * 0.02;
      const toCenter = new THREE.Vector3(-this.position.x, 0, -this.position.z).normalize();
      this.position.addScaledVector(toCenter, pushStrength * this.speed * dt);

      if (overDist > 20) {
        const dotToCenter = this.getForward().dot(toCenter);
        if (dotToCenter < 0.5) {
          const targetQuat = new THREE.Quaternion();
          const lookMtx    = new THREE.Matrix4().lookAt(
            this.position, new THREE.Vector3(0, this.position.y, 0), _up
          );
          targetQuat.setFromRotationMatrix(lookMtx);
          this.quaternion.slerp(targetQuat, Math.min(overDist * 0.005, 0.3) * dt * 3);
        }
      }
    }
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

  getMuzzlePosition(): THREE.Vector3 {
    return this.position.clone().addScaledVector(this.getForward(), 0.5);
  }
  getAltitude(): number  { return this.position.y; }
  getSpeedKmh(): number  { return this.speed * 3.6; }
}
