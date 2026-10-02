import * as THREE from '../vendor/three/three.module.js';
import { scenePoint, UNIT } from './coordinates.js';
import { environmentAt, parallaxOffset } from './visual-state.js';

const seeded = (seed = 91) => () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
function texture(width, height, paint) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
function cloudTexture() {
  return texture(512, 256, (c, w, h) => {
    const rand = seeded(604);
    // CPU-baked multiscale density: one reusable texture, no runtime noise shader.
    const octaves = [12, 24, 48, 96].map(size => ({ size,
      values: Float32Array.from({ length: (size + 1) * (size + 1) }, rand) }));
    const smooth = t => t * t * (3 - 2 * t);
    function noise(x, y, octave) {
      const { size, values } = octave, px = x * size, py = y * size;
      const ix = Math.floor(px), iy = Math.floor(py), fx = smooth(px - ix), fy = smooth(py - iy);
      const i = iy * (size + 1) + ix;
      const a = values[i] * (1 - fx) + values[i + 1] * fx;
      const b = values[i + size + 1] * (1 - fx) + values[i + size + 2] * fx;
      return a * (1 - fy) + b * fy;
    }
    const pixels = c.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const n = noise(u, v, octaves[0]) * .54 + noise(u, v, octaves[1]) * .26
        + noise(u, v, octaves[2]) * .13 + noise(u, v, octaves[3]) * .07;
      const envelope = Math.exp(-(((u - .5) / .42) ** 4) * 2 - ((v - .56) / .23) ** 2 * 1.6);
      const density = Math.max(0, Math.min(1, (n - .29) * 2.5));
      const light = 82 + n * 135 + (1 - v) * 12, i = (y * w + x) * 4;
      pixels.data[i] = light; pixels.data[i + 1] = light + 9; pixels.data[i + 2] = light + 17;
      pixels.data[i + 3] = density * envelope * 230;
    }
    c.putImageData(pixels, 0, 0);
  });
}
function moonTexture() {
  return texture(512, 512, (c, w, h) => {
    const rand = seeded(716); const r = w * .465;
    c.save(); c.beginPath(); c.arc(w / 2, h / 2, r, 0, Math.PI * 2); c.clip();
    const gradient = c.createRadialGradient(w * .72, h * .25, 10, w * .50, h * .46, r * 1.35);
    gradient.addColorStop(0, '#71818d'); gradient.addColorStop(.5, '#3f505f'); gradient.addColorStop(1, '#101b28');
    c.fillStyle = gradient; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = rand() * w, y = rand() * h, radius = 1 + rand() ** 3 * 19;
      c.fillStyle = `rgba(${rand() > .45 ? '8,15,24' : '166,182,191'},${.012 + rand() * .045})`;
      c.beginPath(); c.ellipse(x, y, radius, radius * .78, -.4, 0, Math.PI * 2); c.fill();
    }
    const shadow = c.createRadialGradient(w * .1, h * .64, 75, w * .17, h * .59, w * .76);
    shadow.addColorStop(0, '#050c16f0'); shadow.addColorStop(.52, '#050c16aa'); shadow.addColorStop(1, '#050c1600');
    c.fillStyle = shadow; c.fillRect(0, 0, w, h); c.restore();
  });
}

export function createEnvironment(scene, materials, quality = {}) {
  const geometries = new Set(), ownedMaterials = new Set(), textures = new Set(), instances = new Set();
  const ownG = g => { geometries.add(g); return g; }, ownM = m => { ownedMaterials.add(m); return m; };
  const ownT = t => { textures.add(t); return t; };
  const sky = new THREE.Group(); sky.name = 'Altitude environment'; scene.add(sky);
  const plane = ownG(new THREE.PlaneGeometry(1, 1));
  const box = ownG(new THREE.BoxGeometry(1, 1, 1));
  function card(map, color, opacity, size, position, additive = false) {
    const material = ownM(new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity,
      depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    const mesh = new THREE.Mesh(plane, material); mesh.scale.set(...size, 1); mesh.position.set(...position);
    sky.add(mesh); return mesh;
  }
  // Baked atmosphere, very distant ridge silhouettes and a low warm horizon.
  const hazeMap = ownT(texture(64, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a142000'); g.addColorStop(.42, '#354c6680');
    g.addColorStop(.68, '#768389bb'); g.addColorStop(.77, '#ad966777'); g.addColorStop(1, '#14223000');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }));
  const haze = card(hazeMap, '#c0cdd6', .78, [26, 14], [0, -2.3, -18]);
  const ridgeMap = ownT(texture(1024, 512, (c, w, h) => {
    const rand = seeded(202); c.fillStyle = '#1e2d3a'; c.beginPath(); c.moveTo(0, h);
    let y = 100; for (let x = 0; x <= w; x += 12) { y = Math.max(40, Math.min(145, y + (rand() - .5) * 55)); c.lineTo(x, y); }
    c.lineTo(w, h); c.closePath(); c.fill();
  }));
  const mountains = card(ridgeMap, '#738796', .8, [24, 7.6], [0, -5.4, -15]);
  const moon = card(ownT(moonTexture()), '#92a5b5', .7, [3.7, 3.7], [-2.75, .30, -10]);
  // Points in two layers: stable seeded positions, subtly different pixel sizes.
  const stars = [];
  for (let layer = 0; layer < 2; layer++) {
    const rand = seeded(91 + layer * 17), positions = [], colors = [];
    for (let i = 0; i < (layer ? 90 : 260); i++) {
      positions.push((rand() - .5) * 22, (rand() - .5) * 26, -13 - rand() * 2);
      const v = .22 + rand() * .48; colors.push(v * .77, v * .9, v);
    }
    const geo = ownG(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = ownM(new THREE.PointsMaterial({ size: layer ? 1.65 : 1, sizeAttenuation: false,
      vertexColors: true, transparent: true, opacity: .4, depthWrite: false, fog: false }));
    const points = new THREE.Points(geo, material); sky.add(points); stars.push(points);
  }
  // Shared sparse window atlas: no window meshes and no city lights.
  const windows = ownT(texture(64, 256, (c, w, h) => {
    const rand = seeded(515); c.fillStyle = '#304551'; c.fillRect(0, 0, w, h);
    for (let y = 5; y < h; y += 6) for (let x = 4; x < w; x += 7) {
      if (rand() > .30) continue;
      c.fillStyle = rand() > .25 ? '#bec5a9' : '#d0c38d'; c.globalAlpha = .25 + rand() * .6;
      c.fillRect(x, y, 2, 2);
    }
    c.globalAlpha = 1;
  }));
  const cityLayers = [];
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), scale = new THREE.Vector3();
  for (const [count, z, spread, base, seed] of [[52, -8, 14, -4.8, 212], [14, -3.8, 8, -4.4, 442]]) {
    const rand = seeded(seed);
    const material = ownM(new THREE.MeshBasicMaterial({ map: windows, color: count > 20 ? '#bac9d0' : '#93a6ad',
      transparent: true, opacity: 1, depthWrite: true, fog: false }));
    const buildings = new THREE.InstancedMesh(box, material, count);
    const antennas = new THREE.InstancedMesh(box, material, count);
    const group = new THREE.Group(); group.name = count > 20 ? 'Far city / 52 buildings' : 'Near skyline / 14 buildings';
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1) - .5) * spread + (rand() - .5) * .17;
      const h = .4 + rand() ** 1.5 * (count > 20 ? 1.8 : 2.5);
      const width = .15 + rand() * .35, depth = .22 + rand() * .24;
      matrix.compose(v.set(x, base + (h - 4) / 2, z - rand() * .7), q, scale.set(width, h + 4, depth)); buildings.setMatrixAt(i, matrix);
      matrix.compose(v.set(x, base + h + .1, z - .2), q, scale.set(.016, .12 + rand() * .22, .016)); antennas.setMatrixAt(i, matrix);
      buildings.setColorAt(i, new THREE.Color().setScalar(.5 + rand() * .5));
    }
    instances.add(buildings); instances.add(antennas);
    group.add(buildings, antennas); sky.add(group); cityLayers.push({ group, material });
  }
  const beamMap = ownT(texture(64, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#c8edb000'); g.addColorStop(.46, '#c8edb025'); g.addColorStop(.50, '#e4f3d9dd');
    g.addColorStop(.54, '#c8edb025'); g.addColorStop(1, '#c8edb000'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'destination-in'; const fade = c.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, '#fff0'); fade.addColorStop(.4, '#fff'); fade.addColorStop(1, '#fff0'); c.fillStyle = fade; c.fillRect(0, 0, w, h);
  }));
  const beams = [-3.1, -1.95, 1.45, 2.5].map((x, i) => {
    const beam = card(beamMap, new THREE.Color(2.1, 2.6, 1.5), .16, [.18, 7 + i], [x, -1.8, -5.4 - i * .3], true);
    return beam;
  });
  // Twelve cards behind the collision plane; no cloud ever occludes a module.
  const cloudMap = ownT(cloudTexture()); const clouds = [];
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1, layer = Math.floor(i / 2);
    const mesh = card(cloudMap, layer % 2 ? '#a1b1bf' : '#d0d9df', .1,
      [4.4 + layer * .18, 2.3 + layer * .12], [side * (2.4 + layer * .10), -3.4 + layer * 1.45, -2.5 - layer * .8]);
    clouds.push({ mesh, x: mesh.position.x, y: mesh.position.y, phase: i * 1.73 });
  }
  const foundation = new THREE.Group(); foundation.name = 'Relay launch foundation';
  const platformGeometry = ownG(new THREE.CylinderGeometry(.90, 1.03, .11, 8));
  foundation.add(new THREE.Mesh(platformGeometry, materials.panel));
  const collarGeometry = ownG(new THREE.CylinderGeometry(.62, .77, .10, 8));
  const collar = new THREE.Mesh(collarGeometry, materials.body); collar.position.y = .10; foundation.add(collar);
  const edgeGeometry = ownG(new THREE.TorusGeometry(.85, .009, 4, 8));
  const edge = new THREE.Mesh(edgeGeometry, materials.signal); edge.rotation.x = Math.PI / 2; edge.position.y = .065;
  foundation.add(edge); scene.add(foundation);
  const groundColor = new THREE.Color('#09121e'), spaceColor = new THREE.Color('#030710');
  let visualFloor = 0, lastTime = null, base = null, state = environmentAt(0);
  return {
    sync(engine) {
      if (base !== engine.tower[0]) { base = engine.tower[0]; visualFloor = engine.height; lastTime = engine.time; }
      const dt = Math.max(0, Math.min(.1, engine.time - (lastTime ?? engine.time))); lastTime = engine.time;
      visualFloor += (engine.height - visualFloor) * (1 - Math.exp(-dt * 3));
      state = environmentAt(visualFloor);
      const center = scenePoint(engine.camera.x, engine.camera.y + engine.viewHeight / 2);
      const altitude = Math.max(0, -engine.camera.y - Math.max(engine.config.MIN_TOP_SCREEN, engine.viewHeight * engine.config.INITIAL_FLOOR_RATIO)) * UNIT;
      sky.position.set(center.x, center.y, 0);
      scene.background.copy(groundColor).lerp(spaceColor, state.space);
      haze.position.y = -2.3 + parallaxOffset(altitude, 'mountains'); haze.material.opacity = .78 * state.haze;
      mountains.position.y = -5.4 + parallaxOffset(altitude, 'mountains'); mountains.material.opacity = .8 * (1 - state.space);
      moon.position.y = .3 + parallaxOffset(altitude, 'moon'); moon.material.opacity = .6 + state.space * .2;
      stars.forEach((s, i) => { s.material.opacity = state.stars * (i ? .8 : .7); s.position.y = parallaxOffset(altitude, 'stars');
        s.position.x = engine.reducedMotion ? 0 : Math.sin(engine.time * .009 + i) * .035; });
      cityLayers.forEach(({ group, material }, i) => {
        group.position.y = parallaxOffset(altitude, i ? 'near' : 'far');
        group.position.x = -engine.camera.x * UNIT * (i ? .22 : .08);
        material.opacity = state.city * (i ? .85 : .7); group.visible = state.city > .006;
      });
      beams.forEach((b, i) => { b.position.y = -1.8 + parallaxOffset(altitude, 'far'); b.material.opacity = .17 * state.city; b.visible = state.city > .006; });
      clouds.forEach(({ mesh, x, y, phase }, i) => {
        const detail = quality.atmosphereDetail ?? 1; mesh.visible = detail > .5 || i < 6;
        mesh.position.x = x + Math.sin(engine.time * (engine.reducedMotion ? .004 : .027) + phase) * (engine.reducedMotion ? .025 : .15);
        mesh.position.y = y + 2.0 + Math.max(-8, parallaxOffset(altitude, 'clouds'));
        mesh.material.opacity = state.cloud * (i < 4 ? .75 : .55);
      });
      const anchor = scenePoint(base.x, base.y + base.height + 15, -.24);
      foundation.position.set(anchor.x, anchor.y, anchor.z);
      foundation.visible = anchor.y > center.y - engine.viewHeight * UNIT / 2 - 1.5;
    },
    diagnostics() { return { ...state, cloudCards: clouds.filter(c => c.mesh.visible).length, cityBuildings: 66, beams: beams.length }; },
    releaseGPU() {
      instances.forEach(i => i.dispose()); geometries.forEach(g => g.dispose());
      ownedMaterials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    },
    dispose() { scene.remove(sky, foundation); this.releaseGPU(); },
  };
}
