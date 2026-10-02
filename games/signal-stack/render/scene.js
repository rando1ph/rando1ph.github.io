import * as THREE from '../vendor/three/three.module.js';
import { CAMERA_FOV, cameraFrame } from './coordinates.js';

export function createScene(canvas) {
  const context = canvas.getContext('webgl2', {
    antialias: false, alpha: false, powerPreference: 'high-performance',
  });
  if (!context) throw new Error('WebGL 2 is unavailable.');
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false,
    alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#060b11');
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  return { renderer, scene, camera };
}

export function syncCamera(camera, engineCamera, width, height) {
  const frame = cameraFrame(engineCamera, width, height);
  camera.position.set(frame.x, frame.y, frame.z);
  camera.setViewOffset(width, height, frame.viewOffsetX, frame.viewOffsetY, width, height);
  camera.updateMatrixWorld();
}
