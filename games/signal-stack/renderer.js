import * as THREE from './vendor/three/three.module.js';
import { State } from './engine.js';
import { createScene, syncCamera } from './render/scene.js';
import { modulePose, scenePoint, viewportMapping } from './render/coordinates.js';
import { ModuleRegistry, ModulePool } from './render/bookkeeping.js';
import { createModuleLibrary } from './render/modules.js';
import { createLighting } from './render/lighting.js';
import { createEnvironment } from './render/environment.js';
import { createEffects } from './render/effects.js';
import { createPostprocessing } from './render/postprocessing.js';
import { QualityState, getModuleVariant } from './render/visual-state.js';
import { HUD } from './render/hud.js';

// Rendering only: no event consumption, engine mutations, timers or RAF loop.
export class Renderer {
  constructor(canvas, worldWidth, hud = new HUD(), quality = {}) {
    this.canvas = canvas; this.width = worldWidth; this.hud = hud;
    Object.assign(this, createScene(canvas));
    this.quality = new QualityState(quality);
    this.post = null;
    if (this.quality.config.bloom) {
      try { this.post = createPostprocessing(this.renderer, this.scene, this.camera); }
      catch (error) { this.quality.disableBloom('compositor-unavailable'); console.warn('Bloom unavailable:', error.message); }
    }
    this.renderer.info.autoReset = false;
    this.modules = createModuleLibrary();
    this.registry = new ModuleRegistry();
    this.pool = new ModulePool(() => this.modules.create(),
      group => this.scene.add(group), group => this.scene.remove(group));
    this.lighting = createLighting(this.scene);
    this.environment = createEnvironment(this.scene, this.modules.materials, this.quality.config);
    this.effects = createEffects(this.scene, this.quality.config);
    this.tetherGeometry = new THREE.BufferGeometry();
    this.tetherGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.tetherMaterial = new THREE.LineBasicMaterial({ color: '#90a19a', transparent: true, opacity: 0.32 });
    this.tether = new THREE.Line(this.tetherGeometry, this.tetherMaterial);
    this.tether.frustumCulled = false;
    this.scene.add(this.tether);
    this.carrierGeometry = new THREE.BoxGeometry(0.56, 0.035, 0.12);
    this.carrier = new THREE.Mesh(this.carrierGeometry, this.modules.materials.metal);
    this.scene.add(this.carrier);
    this.guideGeometry = new THREE.BufferGeometry();
    this.guideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.guideMaterial = new THREE.LineDashedMaterial({ color: '#b9d889', transparent: true,
      opacity: .12, dashSize: .065, gapSize: .09, depthWrite: false });
    this.guides = new THREE.LineSegments(this.guideGeometry, this.guideMaterial);
    this.guides.frustumCulled = false; this.scene.add(this.guides);
    const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
    const c = glowCanvas.getContext('2d'), gradient = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#c4ef55aa'); gradient.addColorStop(.3, '#c4ef5544'); gradient.addColorStop(1, '#c4ef5500');
    c.fillStyle = gradient; c.fillRect(0, 0, 64, 64);
    this.glowTexture = new THREE.CanvasTexture(glowCanvas); this.glowTexture.colorSpace = THREE.SRGBColorSpace;
    this.glowGeometry = new THREE.PlaneGeometry(1.35, .55);
    this.glowMaterial = new THREE.MeshBasicMaterial({ map: this.glowTexture, transparent: true, opacity: .20,
      depthWrite: false, blending: THREE.AdditiveBlending });
    this.activeGlow = new THREE.Mesh(this.glowGeometry, this.glowMaterial); this.scene.add(this.activeGlow);
    this.disposed = false;
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, bounds.width), cssHeight = Math.max(1, bounds.height);
    const view = viewportMapping(cssWidth, cssHeight, this.width);
    this.height = view.height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(cssWidth, cssHeight, false);
    this.post?.resize(cssWidth, cssHeight, this.renderer.getPixelRatio());
    this.quality.resetTiming();
    return this.height;
  }

  draw(engine, paused = false, presentation = null) {
    if (this.disposed) return;
    syncCamera(this.camera, engine.camera, this.width, this.height);
    const entries = this.registry.select(engine, this.height);
    const objects = this.pool.sync(entries);
    const pulse = this.effects.sync(engine);
    if (paused) this.quality.resetTiming();
    const visibleSpan = Math.max(44, engine.viewHeight * .70);
    const failing = [State.FALLING_LEFT, State.FALLING_RIGHT, State.MISSED].includes(engine.state);
    const signal = presentation?.signal ?? 1;
    for (const entry of entries) {
      const group = objects.get(entry.id), pose = modulePose(entry.block);
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.set(0, 0, pose.rotationZ);
      group.scale.set(pose.width, pose.height / 0.44, 1);
      this.modules.setVariant(group, getModuleVariant(entry.floor));
      const energy = this.effects.energyAt(engine, entry.block, visibleSpan);
      const failure = entry.active && failing ? Math.max(.08, .65 - Math.abs(entry.block.angle || 0) * .25) : 1;
      this.modules.setEnergy(group, energy, entry.active && !failing, failure * signal);
    }
    const suspended = [State.READY, State.SWINGING].includes(engine.state);
    this.tether.visible = this.carrier.visible = this.guides.visible = this.activeGlow.visible = suspended;
    if (suspended) {
      const a = scenePoint(engine.carrier.x, engine.carrier.y);
      const b = scenePoint(engine.active.x, engine.active.y);
      const position = this.tetherGeometry.attributes.position;
      position.setXYZ(0, a.x, a.y, -0.12); position.setXYZ(1, b.x, b.y, -0.12);
      position.needsUpdate = true;
      this.carrier.position.set(a.x, a.y, -0.12);
      const guide = this.guideGeometry.attributes.position;
      for (let side = 0; side < 2; side++) {
        const x = b.x + (side ? .57 : -.57);
        guide.setXYZ(side * 2, x, b.y + .6, -.24);
        guide.setXYZ(side * 2 + 1, x, b.y - .8, -.24);
      }
      guide.needsUpdate = true; this.guides.computeLineDistances();
      this.guideMaterial.opacity = .10 + pulse * .08;
      this.activeGlow.position.set(b.x, b.y - engine.active.height * .01 - .03, -.13);
    }
    this.lighting.sync(engine, pulse, signal);
    this.environment.sync(engine);
    this.hud.sync(engine, paused, presentation);
    this.renderer.info.reset();
    if (this.post && this.quality.config.bloom) {
      try { this.post.render(); }
      catch (error) {
        this.disableBloom('compositor-error'); this.renderer.setRenderTarget(null); this.renderer.autoClear = true;
        this.renderer.render(this.scene, this.camera); console.warn('Bloom disabled:', error.message);
      }
    } else this.renderer.render(this.scene, this.camera);
  }

  observeFrame(time) {
    this.quality.observe(time);
    if (!this.quality.config.bloom && this.post) this.disableBloom(this.quality.reason);
  }

  disableBloom(reason = 'configured') {
    this.quality.disableBloom(reason); this.post?.dispose(); this.post = null;
  }

  loseContext() {
    // Dispose while GL is still lost: deleting old-context handles after
    // restoration produces INVALID_OPERATION on real browsers.
    this.post?.dispose(); this.post = null;
    // Detach the old GL disposal listeners while retaining CPU geometry,
    // textures, scene objects and effect timelines for Three's next upload.
    this.modules.releaseGPU(); this.environment.releaseGPU(); this.effects.releaseGPU();
    this.releaseDecorations();
  }

  restoreContext() {
    // Three rebuilds buffers/textures from retained CPU resources. Recreate
    // only the compositor, whose render targets belonged to the lost context.
    if (this.quality.config.bloom) {
      try { this.post = createPostprocessing(this.renderer, this.scene, this.camera); }
      catch { this.quality.disableBloom('context-recovery'); }
    }
    this.quality.resetTiming();
  }

  // Read-only diagnostics for development QA; never drives game decisions.
  diagnostics() {
    const info = this.renderer.info;
    return { revision: THREE.REVISION, visibleModules: this.pool.live.size,
      pooledModules: this.pool.free.length, allocatedModules: this.pool.allocated,
      sceneObjects: countObjects(this.scene), drawCalls: info.render.calls,
      triangles: info.render.triangles, geometries: info.memory.geometries,
      textures: info.memory.textures, pixelRatio: this.renderer.getPixelRatio(),
      bloom: this.quality.config.bloom, bloomFallback: this.quality.reason,
      compositor: this.post?.diagnostics() ?? null,
      environment: this.environment.diagnostics(), effects: this.effects.diagnostics(),
      variants: [...this.pool.live.values()].map(g => g.userData.variant) };
  }

  releaseDecorations() {
    this.tetherGeometry.dispose(); this.tetherMaterial.dispose(); this.carrierGeometry.dispose();
    this.guideGeometry.dispose(); this.guideMaterial.dispose();
    this.glowTexture.dispose(); this.glowGeometry.dispose(); this.glowMaterial.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pool.clear(); this.effects.dispose(); this.environment.dispose();
    this.releaseDecorations();
    this.post?.dispose(); this.post = null;
    this.modules.dispose(); this.scene.clear(); this.renderer.dispose();
  }
}

function countObjects(root) { let count = 0; root.traverse(() => count++); return count; }
