import * as THREE from 'three';
import { CameraMode } from '../shared/types';

const _idealPosition = new THREE.Vector3();
const _idealLookAt = new THREE.Vector3();
const _tempVec = new THREE.Vector3();

export class CameraManager {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = 'chase';
  
  // Chase camera settings
  private chaseOffset = new THREE.Vector3(0, 4, -14);
  private chaseLookAhead = 10;
  private chaseSmoothFactor = 4.0;
  
  // Cockpit settings
  private cockpitOffset = new THREE.Vector3(0, 0.8, 1.0);
  
  // Transition
  private isTransitioning = false;
  private transitionTime = 0;
  private transitionDuration = 0.4;
  private transitionStartPos = new THREE.Vector3();
  private transitionStartQuat = new THREE.Quaternion();
  
  // Shake
  private shakeIntensity = 0;
  private shakeDecay = 5;
  
  // Cockpit interior group (toggled visibility)
  public cockpitInterior: THREE.Group | null = null;
  
  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.5, 2000);
  }
  
  toggleMode() {
    // Start transition
    this.isTransitioning = true;
    this.transitionTime = 0;
    this.transitionStartPos.copy(this.camera.position);
    this.transitionStartQuat.copy(this.camera.quaternion);
    
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    
    // Toggle cockpit interior visibility
    if (this.cockpitInterior) {
      this.cockpitInterior.visible = this.mode === 'cockpit';
    }
  }
  
  addShake(intensity: number) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }
  
  update(
    targetPosition: THREE.Vector3,
    targetQuaternion: THREE.Quaternion,
    targetVelocity: THREE.Vector3,
    dt: number,
    buildingColliders?: THREE.Box3[]
  ) {
    if (this.mode === 'chase') {
      this.updateChase(targetPosition, targetQuaternion, targetVelocity, dt, buildingColliders);
    } else {
      this.updateCockpit(targetPosition, targetQuaternion, dt);
    }
    
    // Apply camera shake
    if (this.shakeIntensity > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.exp(-this.shakeDecay * dt);
    }
    
    // Handle transition blend
    if (this.isTransitioning) {
      this.transitionTime += dt;
      const t = Math.min(this.transitionTime / this.transitionDuration, 1);
      const eased = t * t * (3 - 2 * t); // smoothstep
      
      if (t < 1) {
        // Blend from start to current target
        this.camera.position.lerpVectors(this.transitionStartPos, this.camera.position, eased);
        this.camera.quaternion.slerpQuaternions(this.transitionStartQuat, this.camera.quaternion, eased);
      } else {
        this.isTransitioning = false;
      }
    }
  }
  
  private updateChase(
    targetPosition: THREE.Vector3,
    targetQuaternion: THREE.Quaternion,
    targetVelocity: THREE.Vector3,
    dt: number,
    buildingColliders?: THREE.Box3[]
  ) {
    // Reset camera up to world up for chase cam
    this.camera.up.set(0, 1, 0);
    
    // Calculate ideal camera position (behind and above the plane)
    _idealPosition.copy(this.chaseOffset).applyQuaternion(targetQuaternion).add(targetPosition);
    
    // Look-ahead point
    _idealLookAt.copy(targetPosition).addScaledVector(
      _tempVec.set(0, 0, 1).applyQuaternion(targetQuaternion),
      this.chaseLookAhead
    );
    
    // Check for building occlusion
    if (buildingColliders) {
      const ray = new THREE.Ray();
      ray.origin.copy(targetPosition);
      ray.direction.copy(_idealPosition).sub(targetPosition).normalize();
      const maxDist = targetPosition.distanceTo(_idealPosition);
      
      let blocked = false;
      const testBox = new THREE.Box3();
      
      for (const collider of buildingColliders) {
        // Slightly expand collider for safety margin
        testBox.copy(collider).expandByScalar(1);
        const hitPoint = new THREE.Vector3();
        if (ray.intersectBox(testBox, hitPoint)) {
          const hitDist = targetPosition.distanceTo(hitPoint);
          if (hitDist < maxDist) {
            // Move camera closer to plane
            const safeRatio = (hitDist - 2) / maxDist;
            _idealPosition.lerpVectors(targetPosition, _idealPosition, Math.max(0.2, safeRatio));
            blocked = true;
            break;
          }
        }
      }
    }
    
    // Smoothly follow
    const lerpFactor = 1 - Math.exp(-this.chaseSmoothFactor * dt);
    this.camera.position.lerp(_idealPosition, lerpFactor);
    
    // Look at the aircraft (slightly ahead)
    this.camera.lookAt(_idealLookAt);
  }
  
  private updateCockpit(
    targetPosition: THREE.Vector3,
    targetQuaternion: THREE.Quaternion,
    dt: number
  ) {
    // Position at cockpit location
    _idealPosition.copy(this.cockpitOffset).applyQuaternion(targetQuaternion).add(targetPosition);
    this.camera.position.copy(_idealPosition);
    
    // Set camera up to plane's local up so roll is visible in cockpit
    this.camera.up.set(0, 1, 0).applyQuaternion(targetQuaternion);
    
    // Look forward from the plane
    _idealLookAt.set(0, 0, 20).applyQuaternion(targetQuaternion).add(targetPosition);
    this.camera.lookAt(_idealLookAt);
  }
  
  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
