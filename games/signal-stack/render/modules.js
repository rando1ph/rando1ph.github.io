import * as THREE from '../vendor/three/three.module.js';
import { ARCHETYPES } from './visual-state.js';

// Six assemblies in one industrial family. Relay Mk.I retains its accepted
// geometry. Each archetype shares five merged buffers across the bounded pool.
export function createModuleLibrary() {
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: '#20282d', roughness: 0.58, metalness: 0.45 }),
    panel: new THREE.MeshStandardMaterial({ color: '#404b53', roughness: 0.48, metalness: 0.45 }),
    metal: new THREE.MeshStandardMaterial({ color: '#7b8b93', roughness: 0.36, metalness: 0.65 }),
    signal: new THREE.MeshStandardMaterial({ color: '#a6c847', emissive: '#b6ed36', emissiveIntensity: 1.65, roughness: 0.34, metalness: 0.15 }),
    glass: new THREE.MeshStandardMaterial({ color: '#060d13', roughness: 0.24, metalness: 0.35 }),
  };
  const pulseMaterial = materials.signal.clone();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  let parts;
  const families = {};
  const signalMaterials = new Set();
  const makeParts = () => Object.fromEntries(Object.keys(materials).map(key => [key, []]));
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  function part(material, size, pos, rotation = [0, 0, 0], primitive = box) {
    quaternion.setFromEuler(euler.set(...rotation));
    matrix.compose(position.set(pos[0], pos[1], pos[2] * 1.25), quaternion, scale.set(size[0], size[1], size[2] * 1.25));
    const geometry = primitive.clone().applyMatrix4(matrix);
    const expanded = geometry.toNonIndexed();
    geometry.dispose(); parts[material].push(expanded);
  }

  for (const variant of ARCHETYPES) {
    parts = makeParts();
    // Chassis, recessed fascia, full-width top plate and bottom docking rail.
    // Front/collision plane z=0; the assembled depth is expanded 1.25x behind
    // that plane (0.60 units). Front panel relief remains less than one pixel.
    if (variant !== 'STRUCTURE') part('body', [0.98, 0.40, 0.45], [0, 0, -0.237]);
    else part('body', [0.94, 0.34, 0.035], [0, 0, -0.43]);
    if (variant !== 'STRUCTURE') part('glass', [0.90, 0.326, 0.014], [0, 0, -0.008]);
    part('panel', [1, 0.025, 0.48], [0, 0.2075, -0.24]);
    part('body', [1, 0.03, 0.48], [0, -0.205, -0.24]);
    part('metal', [0.88, 0.008, 0.43], [0, 0.22 - 0.004, -0.245]);
    part('panel', [0.71, 0.021, 0.27], [0, 0.211, -0.27]);
    part('glass', [0.50, 0.008, 0.16], [0, 0.224, -0.27]);
    // Connector segments stay narrow: light is an accent, not the whole body.
    for (const x of [-0.32, 0.32]) {
      part('signal', [0.20, 0.016, 0.026], [x, -0.196, 0]);
      part('metal', [0.22, 0.018, 0.046], [x, -0.208, -0.05]);
    }
    if (variant === 'RELAY') {
    // Left armored service panel, inset inner plate, locking tabs and seams.
    part('panel', [0.315, 0.282, 0.024], [-0.274, 0.008, 0.001]);
    part('body', [0.268, 0.224, 0.007], [-0.276, 0.012, 0.017]);
    part('panel', [0.238, 0.173, 0.006], [-0.275, 0.025, 0.022]);
    part('metal', [0.008, 0.094, 0.009], [-0.39, 0.054, 0.027]);
    part('metal', [0.026, 0.018, 0.013], [-0.17, -0.066, 0.028]);
    for (const y of [-0.10, 0.131]) part('glass', [0.251, 0.006, 0.004], [-0.272, y, 0.027]);
    // Central raised spine enclosing a recessed vertical signal channel.
    part('body', [0.139, 0.351, 0.045], [-0.028, 0, 0]);
    for (const x of [-0.091, 0.033]) part('metal', [0.012, 0.286, 0.011], [x, 0, 0.026]);
    part('glass', [0.068, 0.307, 0.010], [-0.028, 0, 0.025]);
    part('signal', [0.031, 0.265, 0.007], [-0.028, 0.003, 0.033]);
    part('signal', [0.014, 0.041, 0.007], [-0.028, 0.166, 0.024]);
    // Recessed right grille: visible gaps, cool machined edges, short fins.
    part('panel', [0.25, 0.30, 0.023], [0.274, 0, 0]);
    part('glass', [0.21, 0.249, 0.011], [0.274, -0.005, 0.015]);
    for (let i = 0; i < 7; i++) {
      part('panel', [0.173, 0.013, 0.019], [0.274, -0.104 + i * 0.034, 0.022]);
      part('metal', [0.142, 0.004, 0.003], [0.28, -0.10 + i * 0.034, 0.033]);
    }
    } else if (variant === 'POWER' || variant === 'CORE') {
      const core = variant === 'CORE';
      for (const side of [-1, 1]) {
        part('panel', [core ? .23 : .28, .32, .04], [side * .30, 0, -.005]);
        part('body', [.16, .25, .008], [side * .30, 0, .019]);
        part('metal', [.025, .27, .012], [side * .16, 0, .025]);
        part('metal', [.22, .027, .04], [side * .28, -.15, .023]);
        for (const y of [-.08, 0, .08]) part('glass', [.12, .008, .009], [side * .30, y, .025]);
      }
      part('metal', [core ? .20 : .17, .33, .036], [0, 0, .006]);
      part('glass', [core ? .16 : .13, .29, .012], [0, 0, .029]);
      part('signal', [core ? .102 : .065, .265, .01], [0, 0, .039]);
      for (const y of [-.154, .154]) part('metal', [.19, .033, .025], [0, y, .039]);
      if (core) {
        for (const y of [-.18, .18]) part('signal', [.60, .017, .03], [0, y, .013]);
        for (const x of [-.39, .39]) part('signal', [.025, .075, .008], [x, .055, .024]);
      }
    } else if (variant === 'COOLING') {
      part('panel', [.78, .30, .025], [0, 0, .002]);
      part('glass', [.71, .25, .014], [0, 0, .02]);
      for (let i = 0; i < 6; i++) {
        part('panel', [.68, .024, .02], [0, -.108 + i * .041, .022]);
        part('metal', [.64, .004, .009], [0, -.099 + i * .041, .034]);
      }
      for (const x of [-.22, .22]) part('body', [.018, .26, .016], [x, 0, .035]);
      part('signal', [.078, .012, .007], [-.30, .16, .028]);
    } else if (variant === 'STRUCTURE') {
      for (const x of [-.42, 0, .42]) part('metal', [.035, .34, .35], [x, 0, -.19]);
      for (const side of [-1, 1]) {
        for (const angle of [-.94, .94]) part('panel', [.027, .45, .023], [side * .21, 0, -.015], [0, 0, angle]);
        part('signal', [.033, .025, .013], [side * .21, 0, .015]);
      }
      for (const y of [-.16, .16]) part('metal', [.84, .025, .035], [0, y, .006]);
      part('body', [.08, .30, .10], [0, 0, -.23]);
    } else if (variant === 'ARRAY') {
      part('panel', [.31, .29, .028], [-.26, 0, .003]);
      for (let i = 0; i < 4; i++) {
        part('body', [.25, .036, .012], [-.26, -.10 + i * .064, .022]);
        part('signal', [.035, .009, .01], [-.34, -.10 + i * .064, .032]);
      }
      // Small dish sits wholly inside the same frontal footprint, never a hitbox.
      part('metal', [.128, .028, .128], [.22, .015, -.003], [Math.PI / 2, 0, 0], cylinder);
      part('panel', [.112, .009, .112], [.22, .015, .016], [Math.PI / 2, 0, 0], cylinder);
      part('glass', [.082, .007, .082], [.22, .015, .023], [Math.PI / 2, 0, 0], cylinder);
      part('signal', [.013, .016, .013], [.22, .015, .032], [Math.PI / 2, 0, 0], cylinder);
      for (const x of [.08, .37]) {
        part('metal', [.013, .22, .014], [x, 0, -.12]);
        part('signal', [.019, .014, .015], [x, .11, -.12]);
      }
      part('metal', [.22, .015, .014], [.22, -.13, .014]);
    }
    // Corner guards with recessed fasteners, plus two tiny status indicators.
    for (const x of [-0.466, 0.466]) {
      part('panel', [0.057, 0.34, 0.07], [x, 0, -0.019]);
      for (const y of [-0.14, 0.14]) {
        part('glass', [0.025, 0.030, 0.004], [x, y, 0.018]);
        part('metal', [0.009, 0.005, 0.009], [x, y, 0.022], [Math.PI / 2, 0, 0], cylinder);
      }
    }
    for (const x of [0.113, 0.156]) part('signal', [0.019, 0.013, 0.008], [x, 0.128, 0.013]);
    // Both side plates are actual layered geometry, with inset grilles and rails.
    for (const side of [-1, 1]) {
      part('panel', [0.012, 0.309, 0.337], [side * 0.495, 0, -0.264]);
      part('glass', [0.006, 0.209, 0.23], [side * 0.503, 0, -0.27]);
      for (const z of [-0.18, -0.24, -0.30, -0.36])
        part('metal', [0.011, 0.165, 0.008], [side * 0.507, 0, z]);
      part('signal', [0.008, 0.016, 0.13], [side * 0.505, -0.16, -0.17]);
    }
    // Restrained relay pins seated in rear top wells, within collision height.
    for (const x of [-0.36, 0.36]) {
      part('body', [0.074, 0.035, 0.077], [x, 0.195, -0.397]);
      part('metal', [0.012, 0.040, 0.012], [x, 0.208, -0.397], [0, 0, 0], cylinder);
    }

    const geometries = {};
    for (const [key, chunks] of Object.entries(parts)) {
      const geometry = new THREE.BufferGeometry();
      for (const attribute of ['position', 'normal', 'uv']) {
        const length = chunks.reduce((sum, chunk) => sum + chunk.attributes[attribute].array.length, 0);
        const data = new Float32Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          const source = chunk.attributes[attribute].array;
          data.set(source, offset); offset += source.length;
        }
        geometry.setAttribute(attribute, new THREE.BufferAttribute(data, attribute === 'uv' ? 2 : 3));
      }
      geometry.computeBoundingSphere();
      geometries[key] = geometry;
      chunks.forEach(chunk => chunk.dispose());
    }
    families[variant] = geometries;
  }
  const geometries = families.RELAY;
  box.dispose(); cylinder.dispose();

  return {
    materials, pulseMaterial, families,
    create() {
      const group = new THREE.Group(); group.name = 'Relay Module Mk.I';
      group.userData.variant = 'RELAY';
      group.userData.energy = materials.signal.clone();
      signalMaterials.add(group.userData.energy);
      for (const key of Object.keys(materials)) {
        const mesh = new THREE.Mesh(geometries[key], materials[key]);
        mesh.name = `relay-${key}`; group.add(mesh);
        if (key === 'signal') group.userData.signal = mesh;
      }
      return group;
    },
    setVariant(group, variant) {
      if (group.userData.variant === variant) return;
      const geometry = families[variant] || families.RELAY;
      Object.keys(materials).forEach((key, i) => { group.children[i].geometry = geometry[key]; });
      group.userData.variant = variant; group.name = `${variant} / Signal Module`;
    },
    setEnergy(group, pulse, active = false, failure = 1) {
      const base = group.userData.variant === 'CORE' ? 2.5 : group.userData.variant === 'POWER' ? 2.0 : 1.65;
      const material = group.userData.energy;
      material.emissiveIntensity = (base + pulse * 3.2 + (active ? .3 : 0)) * failure;
      group.userData.signal.material = material;
    },
    setPulse(group, enabled) { group.userData.signal.material = enabled ? pulseMaterial : materials.signal; },
    releaseGPU() {
      Object.values(families).forEach(family => Object.values(family).forEach(geometry => geometry.dispose()));
      signalMaterials.forEach(material => material.dispose());
      Object.values(materials).forEach(material => material.dispose()); pulseMaterial.dispose();
    },
    dispose() { this.releaseGPU(); signalMaterials.clear(); },
  };
}
