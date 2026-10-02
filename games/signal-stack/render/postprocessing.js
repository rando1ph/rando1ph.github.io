import * as THREE from '../vendor/three/three.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const BLOOM = Object.freeze({ strength: .17, radius: .12, threshold: 1.65 });
export function createPostprocessing(renderer, scene, camera) {
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
    throw new Error('HDR render targets are unavailable.');
  }
  const composer = new EffectComposer(renderer);
  // Use the actual integer drawing-buffer size, including fractional CSS/DPR.
  composer.setPixelRatio(1);
  const render = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  const output = new OutputPass();
  composer.addPass(render); composer.addPass(bloom); composer.addPass(output);
  // The scene is rendered once into HDR, thresholded, then tone-mapped once.
  // No multisampled targets; DPR stays at the Phase 2 1.5 cap.
  let disposed = false;
  return {
    composer, bloom,
    resize(width, height, dpr) {
      composer.setSize(Math.floor(width * dpr), Math.floor(height * dpr));
    },
    render() { composer.render(0); },
    diagnostics() { return { width: composer.renderTarget1.width, height: composer.renderTarget1.height,
      targets: 2 + 1 + bloom.renderTargetsHorizontal.length + bloom.renderTargetsVertical.length,
      samples: composer.renderTarget1.samples }; },
    dispose() {
      if (disposed) return; disposed = true;
      render.dispose(); bloom.dispose();
      // r186's dispose omits its high-pass ShaderMaterial; own that cleanup here
      // while preserving the official vendor source byte for byte.
      bloom.materialHighPassFilter.dispose();
      output.dispose(); composer.dispose(); composer.timer.dispose();
    },
  };
}
