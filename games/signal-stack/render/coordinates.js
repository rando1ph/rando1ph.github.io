// The engine owns world pixels: x = horizontal center, y = top, +y = down.
// Scene units: 100 world pixels = 1 unit; +y = up. The collision/front plane
// is ALWAYS z = 0. All substantial decorative depth extends behind it.
export const UNIT = 0.01;
export const CAMERA_FOV = 30;
export const EYE_OFFSET = Object.freeze({ x: 1.65, y: 0.85 });

export function scenePoint(x, y, z = 0) {
  return { x: x * UNIT, y: -y * UNIT, z };
}

export function modulePose(block) {
  return { ...scenePoint(block.x, block.y + block.height / 2),
    rotationZ: -(block.angle || 0), width: block.width * UNIT, height: block.height * UNIT };
}

export function viewportMapping(cssWidth, cssHeight, worldWidth = 390) {
  const scale = Math.max(1, cssWidth) / worldWidth;
  return { scale, width: worldWidth, height: Math.max(1, cssHeight) / scale };
}

export function cameraFrame(camera, width, height) {
  const center = scenePoint(camera.x, camera.y + height / 2);
  const distance = height * UNIT / (2 * Math.tan(CAMERA_FOV * Math.PI / 360));
  return { x: center.x + EYE_OFFSET.x, y: center.y + EYE_OFFSET.y, z: distance,
    // Off-axis perspective (architectural lens shift), never a camera tilt.
    // This exposes top/right depth while projecting EVERY z=0 point exactly
    // to the Phase 1 pixel grid, including edge-contact pivots during rotation.
    viewOffsetX: -EYE_OFFSET.x / UNIT, viewOffsetY: EYE_OFFSET.y / UNIT,
    width, height };
}

export function screenPoint(x, y, camera, width) {
  return { x: x - camera.x + width / 2, y: y - camera.y };
}
