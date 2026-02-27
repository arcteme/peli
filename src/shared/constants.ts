import { AircraftDef, GameConfig } from './types';

export const GAME_CONFIG: GameConfig = {
  mapRadius: 500,           // 500m radius around Kerava center
  mapCenterLat: 60.4033,
  mapCenterLon: 25.1064,
  gravity: 9.81,
  respawnTime: 3,           // seconds
  bulletSpeed: 50,          // m/s — BB/toy-gun speed for 1:10 scale
  bulletLife: 2.0,          // seconds (gives ~100m range)
  tickRate: 20,             // server Hz
};

// Aircraft are 1:10 scale model planes flying through a real-scale world.
// Speeds are scaled down 10× so the full-sized buildings feel enormous.
export const WORLD_SCALE = 0.1;

// Flight physics constants
export const PHYSICS = {
  autoLevelStrength: 0.3,   // how quickly plane returns to level (rad/s)
  dragCoefficient: 0.02,    // air resistance
  gravityEffect: 0.3,       // reduced gravity for arcade feel
  minAltitude: 1,           // floor height in meters (model flies very low)
  maxAltitude: 500,         // ceiling
  groundBounceForce: 20,    // push-up force when too low
  nearMissDistance: 2,      // meters for near-miss detection (scaled for tiny model)
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

// AI enemy spawn points — placed on the opposite side of the map from the
// player (who spawns at x≈+400).  Each entry is x<0 or far z.
export const AI_SPAWN_POINTS = [
  { x: -400, y: 100, z:    0 },
  { x: -283, y: 110, z:  283 },
  { x: -283, y: 110, z: -283 },
  { x:    0, y: 100, z:  400 },
  { x:    0, y: 100, z: -400 },
  { x: -200, y: 110, z: -350 },
];

// Random pilot ace names assigned to AI enemies
export const AI_PILOT_NAMES = [
  'Baron von Kessler',
  'Red Eagle',
  'Iron Hawk',
  'Shadow Wolf',
  'Black Baron',
  'Thunder Jack',
  'Steel Hans',
  'Flying Schroeder',
  'Red Manfred',
  'Hurricane Bill',
  'Deadly Duke',
  'Stuka Kurt',
  'Blue Devil',
  'Night Falcon',
  'Ace McGee',
];

export const AIRCRAFT: Record<string, AircraftDef> = {
  zero: {
    id: 'zero',
    name: 'A6M Zero',
    country: 'Japan',
    countryFlag: '🇯🇵',
    speedMin: 9,
    speedMax: 36,
    speedCruise: 21,
    acceleration: 7.5,
    pitchRate: 2.5,
    yawRate: 1.2,
    rollRate: 3.5,
    health: 80,
    weaponDamage: 12,
    weaponFireRate: 8,
    weaponRange: 80,
    bodyColor: 0x6b7c5e,  // olive green
    accentColor: 0xcc3333, // red (rising sun)
  },
  spitfire: {
    id: 'spitfire',
    name: 'Spitfire Mk.IX',
    country: 'United Kingdom',
    countryFlag: '🇬🇧',
    speedMin: 10.5,
    speedMax: 39,
    speedCruise: 22.5,
    acceleration: 8.4,
    pitchRate: 2.2,
    yawRate: 1.0,
    rollRate: 3.8,
    health: 100,
    weaponDamage: 10,
    weaponFireRate: 10,
    weaponRange: 80,
    bodyColor: 0x5a6e4a,  // RAF green
    accentColor: 0x8b7355, // brown camo
  },
  bf109: {
    id: 'bf109',
    name: 'Bf 109 G-6',
    country: 'Germany',
    countryFlag: '🇩🇪',
    speedMin: 10.5,
    speedMax: 42,
    speedCruise: 24,
    acceleration: 9,
    pitchRate: 2.0,
    yawRate: 0.9,
    rollRate: 3.2,
    health: 110,
    weaponDamage: 14,
    weaponFireRate: 7,
    weaponRange: 80,
    bodyColor: 0x808080,  // field gray
    accentColor: 0xd4c36a, // yellow nose
  },
};

export const AIRCRAFT_LIST = Object.values(AIRCRAFT);
