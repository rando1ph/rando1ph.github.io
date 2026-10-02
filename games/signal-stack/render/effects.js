import * as THREE from '../vendor/three/three.module.js';
import { scenePoint } from './coordinates.js';
import { propagationAt } from './visual-state.js';
import { State } from '../engine.js';

export function perfectEnvelope(engine) {
  if (!engine.feedback?.perfect) return { pulse: 0, progress: 1, visible: false };
  const age = engine.time - (engine.feedback.until - engine.config.FEEDBACK_DURATION);
  const duration = engine.reducedMotion ? .18 : .34;
  const progress = Math.max(0, Math.min(1, age / duration));
  const pulse = Math.max(0, Math.min(1, age / .035)) * Math.max(0, 1 - Math.max(0, age - .07) / (duration - .07));
  return { pulse, progress, visible: age >= 0 && age < duration };
}

export function createEffects(scene, quality = {}) {
  const geometry = new THREE.TorusGeometry(.58, .005, 4, 80);
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 4.8, 1.4), transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(geometry, material); ring.rotation.x = Math.PI / 2 - .18;
  ring.visible = false; scene.add(ring);
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(24 * 3);
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMaterial = new THREE.PointsMaterial({ color: new THREE.Color(2.3, 3.1, 1), size: 2,
    sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sparks = new THREE.Points(particleGeometry, particleMaterial); sparks.frustumCulled = false;
  sparks.visible = false; scene.add(sparks);
  let base = null, feedback = null, timeline = null, failure = null, failureAt = 0;
  return {
    sync(engine) {
      if (base !== engine.tower[0]) { base = engine.tower[0]; feedback = timeline = failure = null; }
      if (engine.feedback?.perfect && feedback !== engine.feedback) {
        feedback = engine.feedback;
        timeline = { block: engine.top, time: feedback.until - engine.config.FEEDBACK_DURATION };
      }
      const age = timeline ? engine.time - timeline.time : Infinity;
      if (age >= .34) timeline = null;
      const effect = perfectEnvelope(engine);
      const ringAge = age - (engine.reducedMotion ? 0 : .045);
      const ringProgress = Math.max(0, Math.min(1, ringAge / (engine.reducedMotion ? .16 : .25)));
      ring.visible = Boolean(timeline && ringAge >= 0 && ringProgress < 1);
      if (ring.visible) {
        const anchor = scenePoint(timeline.block.x, timeline.block.y + timeline.block.height, -.20);
        ring.position.set(anchor.x, anchor.y, anchor.z);
        const scale = engine.reducedMotion ? 1.08 : .85 + 1.4 * (1 - (1 - ringProgress) ** 2);
        ring.scale.setScalar(scale); material.opacity = (1 - ringProgress) * .8;
      }
      const failing = [State.FALLING_LEFT, State.FALLING_RIGHT, State.MISSED].includes(engine.state);
      if (failing && failure !== engine.active) { failure = engine.active; failureAt = engine.time; }
      const failureAge = engine.time - failureAt;
      const perfectSparks = timeline && age >= .025 && age < .28;
      sparks.visible = Boolean(quality.particles !== false && !engine.reducedMotion && (perfectSparks || (failing && failureAge < .14)));
      if (sparks.visible) {
        const b = perfectSparks ? timeline.block : engine.active;
        const a = perfectSparks ? age : failureAge, count = perfectSparks ? 24 : 6;
        const anchor = scenePoint(b.x, b.y + b.height, -.04);
        sparks.position.set(anchor.x, anchor.y, anchor.z);
        for (let i = 0; i < count; i++) {
          const angle = i * 2.39996, speed = .6 + (i % 5) * .16;
          positions[i * 3] = Math.cos(angle) * (.35 + a * speed);
          positions[i * 3 + 1] = Math.sin(angle) * a * speed - a * a * 2;
          positions[i * 3 + 2] = -.03 - (i % 3) * .08;
        }
        particleGeometry.setDrawRange(0, count); particleGeometry.attributes.position.needsUpdate = true;
        particleMaterial.opacity = perfectSparks ? .9 * (1 - age / .28) : .4 * (1 - failureAge / .14);
      }
      return effect.pulse;
    },
    energyAt(engine, block, span) {
      return timeline ? propagationAt(engine.time - timeline.time, Math.max(0, block.y - timeline.block.y), span, engine.reducedMotion) : 0;
    },
    diagnostics() { return { perfectTimelines: timeline ? 1 : 0, particles: sparks.visible ? particleGeometry.drawRange.count : 0, ring: ring.visible }; },
    releaseGPU() { geometry.dispose(); material.dispose(); particleGeometry.dispose(); particleMaterial.dispose(); },
    dispose() {
      scene.remove(ring, sparks); this.releaseGPU(); timeline = null;
    },
  };
}
