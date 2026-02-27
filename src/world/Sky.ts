import * as THREE from 'three';

export class Sky {
  public group: THREE.Group;
  
  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = 'sky';
    
    // Hemisphere light — strong spring fill (60°N, bright diffuse sky)
    const hemiLight = new THREE.HemisphereLight(0x88bbee, 0x7a6a48, 1.0);
    scene.add(hemiLight);

    // Directional light — low south-southeast sun, softer than summer
    const sunLight = new THREE.DirectionalLight(0xffe8c8, 0.9);
    sunLight.position.set(350, 220, -100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 1000;
    sunLight.shadow.camera.left = -400;
    sunLight.shadow.camera.right = 400;
    sunLight.shadow.camera.top = 400;
    sunLight.shadow.camera.bottom = -400;
    scene.add(sunLight);
    
    // Spring sky — bright blue-white
    scene.background = new THREE.Color(0xb8d4e0);

    // Spring haze fog
    scene.fog = new THREE.Fog(0xc8d8e0, 300, 800);
    
    // Simple cloud layer
    this.createClouds();
  }
  
  private createClouds() {
    const cloudMat = new THREE.MeshLambertMaterial({ 
      color: 0xffffff, 
      transparent: true, 
      opacity: 0.6 
    });
    
    for (let i = 0; i < 30; i++) {
      const cloudGroup = new THREE.Group();
      
      // Each cloud = cluster of spheres
      const numPuffs = 3 + Math.floor(Math.random() * 4);
      for (let p = 0; p < numPuffs; p++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(15 + Math.random() * 20, 6, 4),
          cloudMat
        );
        puff.position.set(
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 20
        );
        puff.scale.y = 0.4; // flatten
        cloudGroup.add(puff);
      }
      
      cloudGroup.position.set(
        (Math.random() - 0.5) * 1000,
        200 + Math.random() * 150,
        (Math.random() - 0.5) * 1000
      );
      
      this.group.add(cloudGroup);
    }
  }
}
