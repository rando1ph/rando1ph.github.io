import * as THREE from '../vendor/three/three.module.js';
import { scenePoint } from './coordinates.js';

export function createLighting(scene) {
  const base = new THREE.HemisphereLight('#93afc1', '#151c1b', 0.65);
  const key = new THREE.DirectionalLight('#dde8e5', 3.8);
  const rim = new THREE.DirectionalLight('#668bab', 2.6);
  const signal = new THREE.PointLight('#b4ee42', 0.6, 2.5, 2);
  scene.add(base, key, key.target, rim, rim.target, signal);
  return {
    signal,
    sync(engine, pulse, strength = 1) {
      const center = scenePoint(engine.camera.x, engine.camera.y + engine.viewHeight / 2);
      key.position.set(center.x - 3, center.y + 5, 5);
      key.target.position.set(center.x, center.y, 0);
      rim.position.set(center.x + 4, center.y + 2, -1);
      rim.target.position.set(center.x, center.y, -0.2);
      const b = pulse > 0 ? engine.top : engine.active;
      const anchor = scenePoint(b.x, b.y + b.height / 2);
      signal.position.set(anchor.x - 0.1, anchor.y + 0.3, 0.65);
      signal.intensity = (0.6 + pulse * 2.1) * strength;
    },
  };
}
