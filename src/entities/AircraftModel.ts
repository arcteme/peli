import * as THREE from 'three';
import { AircraftDef } from '../shared/types';

/**
 * Creates placeholder 3D aircraft models from simple geometry.
 * These rough models capture the silhouette of each WW2 aircraft.
 * Will be replaced with proper GLTF models later.
 */
export function createAircraftModel(def: AircraftDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `aircraft-${def.id}`;
  
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: def.bodyColor,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
    roughness: 0.4,
    metalness: 0.1,
  });
  
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: def.accentColor,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
    roughness: 0.4,
    metalness: 0.1,
  });
  
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.4,
    roughness: 0.1,
    metalness: 0.0,
    clearcoat: 1.0,
  });
  
  const darkMat = new THREE.MeshPhysicalMaterial({
    color: 0x333333,
    roughness: 0.6,
    clearcoat: 0.5,
  });
  
  switch (def.id) {
    case 'zero':
      buildZero(group, bodyMat, accentMat, glassMat, darkMat);
      break;
    case 'spitfire':
      buildSpitfire(group, bodyMat, accentMat, glassMat, darkMat);
      break;
    case 'bf109':
      buildBf109(group, bodyMat, accentMat, glassMat, darkMat);
      break;
    default:
      buildGenericFighter(group, bodyMat, accentMat, glassMat, darkMat);
  }
  
  // Add propeller disc
  const propGeo = new THREE.CircleGeometry(0.8, 16);
  const propMat = new THREE.MeshBasicMaterial({ 
    color: 0x555555, 
    transparent: true, 
    opacity: 0.4, 
    side: THREE.DoubleSide 
  });
  const prop = new THREE.Mesh(propGeo, propMat);
  prop.name = 'propeller';
  prop.position.set(0, 0, 3.2); // nose tip
  group.add(prop);
  
  // Scale to 1:10 model — real buildings feel much larger around the tiny aircraft
  group.scale.setScalar(0.15);
  
  return group;
}

function buildZero(group: THREE.Group, body: THREE.Material, accent: THREE.Material, glass: THREE.Material, dark: THREE.Material) {
  // A6M Zero - round cowling, long canopy, round wingtips
  
  // Fuselage - tapered cylinder
  const fuselageGeo = new THREE.CylinderGeometry(0.5, 0.35, 6, 8);
  fuselageGeo.rotateX(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuselageGeo, body);
  fuselage.position.set(0, 0, 0);
  group.add(fuselage);
  
  // Engine cowling (round nose)
  const cowlGeo = new THREE.SphereGeometry(0.55, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cowlGeo.rotateX(-Math.PI / 2);
  const cowl = new THREE.Mesh(cowlGeo, dark);
  cowl.position.set(0, 0, 3);
  group.add(cowl);
  
  // Wings - wide, slightly rounded (box approximation)
  const wingGeo = new THREE.BoxGeometry(10, 0.12, 1.8);
  const wing = new THREE.Mesh(wingGeo, body);
  wing.position.set(0, -0.1, 0.5);
  group.add(wing);
  
  // Wing tips (rounded)
  for (const side of [-1, 1]) {
    const tipGeo = new THREE.SphereGeometry(0.5, 6, 4);
    tipGeo.scale(1, 0.12, 1);
    const tip = new THREE.Mesh(tipGeo, body);
    tip.position.set(side * 5.2, -0.1, 0.5);
    group.add(tip);
  }
  
  // Red dots on wings (Rising Sun insignia placeholder)
  for (const side of [-1, 1]) {
    const dotGeo = new THREE.CircleGeometry(0.4, 8);
    const dot = new THREE.Mesh(dotGeo, accent);
    dot.position.set(side * 2.5, 0.08, 0.5);
    dot.rotation.x = -Math.PI / 2;
    group.add(dot);
  }
  
  // Canopy
  const canopyGeo = new THREE.SphereGeometry(0.45, 8, 6);
  canopyGeo.scale(1, 0.8, 2);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.position.set(0, 0.35, -0.3);
  group.add(canopy);
  
  // Tail fin (vertical stabilizer)
  const tailFinGeo = new THREE.BoxGeometry(0.08, 1.0, 1.2);
  const tailFin = new THREE.Mesh(tailFinGeo, body);
  tailFin.position.set(0, 0.5, -2.8);
  group.add(tailFin);
  
  // Horizontal stabilizers
  const hStabGeo = new THREE.BoxGeometry(3, 0.08, 0.8);
  const hStab = new THREE.Mesh(hStabGeo, body);
  hStab.position.set(0, 0.05, -2.8);
  group.add(hStab);
  
  // Rudder accent
  const rudderGeo = new THREE.BoxGeometry(0.1, 0.6, 0.5);
  const rudder = new THREE.Mesh(rudderGeo, accent);
  rudder.position.set(0, 0.7, -3.2);
  group.add(rudder);
}

function buildSpitfire(group: THREE.Group, body: THREE.Material, accent: THREE.Material, glass: THREE.Material, dark: THREE.Material) {
  // Spitfire - elliptical wings, slim fuselage, distinctive nose
  
  // Fuselage
  const fuselageGeo = new THREE.CylinderGeometry(0.45, 0.3, 6.5, 8);
  fuselageGeo.rotateX(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuselageGeo, body);
  group.add(fuselage);
  
  // Nose / spinner
  const noseGeo = new THREE.ConeGeometry(0.45, 1.2, 8);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, dark);
  nose.position.set(0, 0, 3.5);
  group.add(nose);
  
  // Elliptical wings (Spitfire's signature)
  const wingShape = new THREE.Shape();
  wingShape.ellipse(0, 0, 5.5, 1.2, 0, Math.PI * 2, false, 0);
  const wingExtrudeSettings = { depth: 0.12, bevelEnabled: false };
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, wingExtrudeSettings);
  wingGeo.rotateX(Math.PI / 2);
  wingGeo.translate(0, 0, 0.3);
  const wing = new THREE.Mesh(wingGeo, body);
  wing.position.set(0, -0.1, 0.3);
  group.add(wing);
  
  // Camo accent patches on wing top
  const camoGeo = new THREE.CircleGeometry(1.5, 8);
  for (const cx of [-2, 2]) {
    const camo = new THREE.Mesh(camoGeo, accent);
    camo.rotation.x = -Math.PI / 2;
    camo.position.set(cx, 0.08, 0.3);
    group.add(camo);
  }
  
  // Canopy (long bubble canopy)
  const canopyGeo = new THREE.SphereGeometry(0.38, 8, 6);
  canopyGeo.scale(1, 0.7, 2.5);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.position.set(0, 0.32, -0.5);
  group.add(canopy);
  
  // Tail fin
  const tailFinGeo = new THREE.BoxGeometry(0.08, 1.2, 1.4);
  const tailFin = new THREE.Mesh(tailFinGeo, body);
  tailFin.position.set(0, 0.5, -3.0);
  group.add(tailFin);
  
  // Horizontal stabilizers (also slightly elliptical shape)
  const hStabGeo = new THREE.BoxGeometry(3.2, 0.08, 0.9);
  const hStab = new THREE.Mesh(hStabGeo, body);
  hStab.position.set(0, 0.05, -3.0);
  group.add(hStab);
  
  // RAF roundel placeholders  
  for (const side of [-1, 1]) {
    const roundelGeo = new THREE.CircleGeometry(0.35, 12);
    const roundelMat = new THREE.MeshBasicMaterial({ color: 0x002868 }); // blue
    const roundel = new THREE.Mesh(roundelGeo, roundelMat);
    roundel.rotation.x = -Math.PI / 2;
    roundel.position.set(side * 3, 0.1, 0.3);
    group.add(roundel);
    
    const innerGeo = new THREE.CircleGeometry(0.2, 12);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0xcc0000 }); // red center
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(side * 3, 0.11, 0.3);
    group.add(inner);
  }
}

function buildBf109(group: THREE.Group, body: THREE.Material, accent: THREE.Material, glass: THREE.Material, dark: THREE.Material) {
  // Bf 109 - angular, narrow fuselage, squared wings, yellow nose
  
  // Fuselage (slightly angular)
  const fuselageGeo = new THREE.CylinderGeometry(0.48, 0.28, 6, 6); // 6-sided for angular look
  fuselageGeo.rotateX(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuselageGeo, body);
  group.add(fuselage);
  
  // Yellow nose (Bf 109 signature)
  const noseGeo = new THREE.ConeGeometry(0.48, 1.5, 6);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, accent);
  nose.position.set(0, 0, 3.3);
  group.add(nose);
  
  // Spinner
  const spinnerGeo = new THREE.ConeGeometry(0.15, 0.4, 6);
  spinnerGeo.rotateX(-Math.PI / 2);
  const spinner = new THREE.Mesh(spinnerGeo, dark);
  spinner.position.set(0, 0, 4.1);
  group.add(spinner);
  
  // Wings (narrower, more squared)
  const wingGeo = new THREE.BoxGeometry(9.5, 0.1, 1.6);
  const wing = new THREE.Mesh(wingGeo, body);
  wing.position.set(0, -0.15, 0.2);
  group.add(wing);
  
  // Wing tips (slight taper)
  for (const side of [-1, 1]) {
    const tipGeo = new THREE.BoxGeometry(0.8, 0.08, 1.2);
    const tip = new THREE.Mesh(tipGeo, body);
    tip.position.set(side * 5, -0.15, 0.2);
    tip.rotation.z = side * 0.1;
    group.add(tip);
  }
  
  // Canopy (angular  greenhouse style)
  const canopyGeo = new THREE.BoxGeometry(0.7, 0.55, 1.8);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.position.set(0, 0.35, -0.2);
  group.add(canopy);
  
  // Head armor plate behind canopy
  const armorGeo = new THREE.BoxGeometry(0.65, 0.5, 0.08);
  const armor = new THREE.Mesh(armorGeo, dark);
  armor.position.set(0, 0.3, -1.1);
  group.add(armor);
  
  // Tail fin (angular)
  const tailFinGeo = new THREE.BoxGeometry(0.08, 1.3, 1.5);
  const tailFin = new THREE.Mesh(tailFinGeo, body);
  tailFin.position.set(0, 0.55, -2.8);
  group.add(tailFin);
  
  // Horizontal stabilizers
  const hStabGeo = new THREE.BoxGeometry(2.8, 0.08, 0.9);
  const hStab = new THREE.Mesh(hStabGeo, body);
  hStab.position.set(0, 0.05, -2.8);
  group.add(hStab);
  
  // Balkenkreuz (Iron Cross) placeholders on wings
  for (const side of [-1, 1]) {
    const crossVertGeo = new THREE.PlaneGeometry(0.2, 0.8);
    const crossHorzGeo = new THREE.PlaneGeometry(0.8, 0.2);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const crossV = new THREE.Mesh(crossVertGeo, crossMat);
    const crossH = new THREE.Mesh(crossHorzGeo, crossMat);
    crossV.rotation.x = -Math.PI / 2;
    crossH.rotation.x = -Math.PI / 2;
    crossV.position.set(side * 3, 0.08, 0.2);
    crossH.position.set(side * 3, 0.08, 0.2);
    group.add(crossV);
    group.add(crossH);
  }
}

function buildGenericFighter(group: THREE.Group, body: THREE.Material, accent: THREE.Material, glass: THREE.Material, dark: THREE.Material) {
  // Generic fallback 
  const fuselageGeo = new THREE.CylinderGeometry(0.5, 0.3, 6, 8);
  fuselageGeo.rotateX(Math.PI / 2);
  group.add(new THREE.Mesh(fuselageGeo, body));
  
  const wingGeo = new THREE.BoxGeometry(10, 0.1, 1.5);
  const wing = new THREE.Mesh(wingGeo, body);
  wing.position.set(0, -0.1, 0.3);
  group.add(wing);
  
  const canopyGeo = new THREE.SphereGeometry(0.4, 8, 6);
  canopyGeo.scale(1, 0.7, 2);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.position.set(0, 0.3, -0.3);
  group.add(canopy);
  
  const tailGeo = new THREE.BoxGeometry(0.08, 1.0, 1.0);
  const tail = new THREE.Mesh(tailGeo, body);
  tail.position.set(0, 0.5, -2.8);
  group.add(tail);
  
  const hStabGeo = new THREE.BoxGeometry(2.5, 0.08, 0.7);
  group.add(new THREE.Mesh(hStabGeo, body));
}

/**
 * Cockpit interior — intentionally empty.
 * All aiming is handled by the HTML crosshair in the HUD.
 * No 3D geometry here means a fully clear cockpit view.
 */
export function createCockpitInterior(_def: AircraftDef): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cockpit-interior';
  return group;
}
