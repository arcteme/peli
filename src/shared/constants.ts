import { AircraftDef, GameConfig } from './types';

export const GAME_CONFIG: GameConfig = {
  mapRadius: 500,           // 500m radius around Kerava center
  mapCenterLat: 60.4033,
  mapCenterLon: 25.1064,
  gravity: 9.81,
  respawnTime: 3,           // seconds
  bulletSpeed: 300,         // m/s
  bulletLife: 1.5,          // seconds (gives ~450m range)
  tickRate: 20,             // server Hz
};

// Map scale: we're pretending models are 1:48 scale but flying at realistic-feeling speeds
// through real-sized buildings. This keeps gameplay fun.
export const WORLD_SCALE = 1.0;

// Flight physics constants
export const PHYSICS = {
  autoLevelStrength: 0.3,   // how quickly plane returns to level (rad/s)
  dragCoefficient: 0.02,    // air resistance
  gravityEffect: 0.3,       // reduced gravity for arcade feel
  minAltitude: 5,           // floor height in meters
  maxAltitude: 500,         // ceiling
  groundBounceForce: 20,    // push-up force when too low
  nearMissDistance: 10,     // meters for near-miss detection
};

// Spawn points around Kerava center (x, z positions, y=altitude)
export const SPAWN_POINTS = [
  { x: 400, y: 80, z: 0 },
  { x: -400, y: 80, z: 0 },
  { x: 0, y: 80, z: 400 },
  { x: 0, y: 80, z: -400 },
  { x: 283, y: 90, z: 283 },
  { x: -283, y: 90, z: 283 },
  { x: 283, y: 90, z: -283 },
  { x: -283, y: 90, z: -283 },
  { x: 200, y: 100, z: 350 },
  { x: -200, y: 100, z: -350 },
];

export const AIRCRAFT: Record<string, AircraftDef> = {
  zero: {
    id: 'zero',
    name: 'A6M Zero',
    country: 'Japan',
    countryFlag: '🇯🇵',
    speedMin: 30,
    speedMax: 120,
    speedCruise: 70,
    acceleration: 25,
    pitchRate: 2.5,
    yawRate: 1.2,
    rollRate: 3.5,
    health: 80,
    weaponDamage: 12,
    weaponFireRate: 8,
    weaponRange: 400,
    bodyColor: 0x6b7c5e,  // olive green
    accentColor: 0xcc3333, // red (rising sun)
  },
  spitfire: {
    id: 'spitfire',
    name: 'Spitfire Mk.IX',
    country: 'United Kingdom',
    countryFlag: '🇬🇧',
    speedMin: 35,
    speedMax: 130,
    speedCruise: 75,
    acceleration: 28,
    pitchRate: 2.2,
    yawRate: 1.0,
    rollRate: 3.8,
    health: 100,
    weaponDamage: 10,
    weaponFireRate: 10,
    weaponRange: 450,
    bodyColor: 0x5a6e4a,  // RAF green
    accentColor: 0x8b7355, // brown camo
  },
  bf109: {
    id: 'bf109',
    name: 'Bf 109 G-6',
    country: 'Germany',
    countryFlag: '🇩🇪',
    speedMin: 35,
    speedMax: 140,
    speedCruise: 80,
    acceleration: 30,
    pitchRate: 2.0,
    yawRate: 0.9,
    rollRate: 3.2,
    health: 110,
    weaponDamage: 14,
    weaponFireRate: 7,
    weaponRange: 500,
    bodyColor: 0x808080,  // field gray
    accentColor: 0xd4c36a, // yellow nose
  },
};

export const AIRCRAFT_LIST = Object.values(AIRCRAFT);
