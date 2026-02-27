// Aircraft type identifiers
export type AircraftId = 'zero' | 'spitfire' | 'bf109';

// Aircraft definition with flight characteristics
export interface AircraftDef {
  id: AircraftId;
  name: string;
  country: string;
  countryFlag: string;
  // Speed in m/s (at 1:48 scale these are small but we scale up for fun)
  speedMin: number;
  speedMax: number;
  speedCruise: number;
  acceleration: number;
  // Turn rates in radians/s
  pitchRate: number;
  yawRate: number;
  rollRate: number;
  // Combat
  health: number;
  weaponDamage: number;
  weaponFireRate: number; // rounds per second
  weaponRange: number; // meters
  // Model colors (placeholder)
  bodyColor: number;
  accentColor: number;
}

export interface PlayerState {
  id: string;
  name: string;
  aircraftId: AircraftId;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  speed: number;
  throttle: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  kills: number;
  deaths: number;
  respawnTimer: number;
}

export interface InputState {
  pitch: number;    // -1 to 1
  yaw: number;      // -1 to 1
  roll: number;     // -1 to 1
  throttle: number; // 0 to 1
  fire: boolean;
  toggleCamera: boolean;
}

export interface Bullet {
  id: number;
  ownerId: string;
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  speed: number;
  life: number; // seconds remaining
  damage: number;
}

export type CameraMode = 'chase' | 'cockpit';

export interface GameConfig {
  mapRadius: number;
  mapCenterLat: number;
  mapCenterLon: number;
  gravity: number;
  respawnTime: number;
  bulletSpeed: number;
  bulletLife: number;
  tickRate: number;
}
