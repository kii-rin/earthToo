import * as THREE from 'three/webgpu';

export class Sea {
  private readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, sizeM: number, levelM: number) {
    const geometry = new THREE.PlaneGeometry(sizeM, sizeM);
    const material = new THREE.MeshStandardMaterial({
      color: 0x2d7896,
      transparent: true,
      opacity: 0.78,
      roughness: 0.22,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = levelM;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
