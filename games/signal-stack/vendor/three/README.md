# Three.js r186 — official, offline ES modules

Vendored **verbatim** from the official `mrdoob/three.js` GitHub **r186 tag**.
No CDN, runtime package manager, minified build, mixed revision or WebGPU.
Fetched 2026-10-02. `SHA256SUMS` records every vendored JS file and the MIT license;
paths are relative to the Signal Stack directory.

Core (unchanged from Phase 2):

- https://raw.githubusercontent.com/mrdoob/three.js/r186/build/three.module.js
- https://raw.githubusercontent.com/mrdoob/three.js/r186/build/three.core.js
- https://raw.githubusercontent.com/mrdoob/three.js/r186/LICENSE

`three.module.js` requires `three.core.js`. The original MIT notice remains at
`../../LICENSE-three.txt`.

Phase 3 addons all come from this exact prefix:

https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/

| File under `addons/` | Imports verified in official r186 source |
| --- | --- |
| `postprocessing/EffectComposer.js` | three, CopyShader, ShaderPass, MaskPass |
| `postprocessing/RenderPass.js` | three, Pass |
| `postprocessing/UnrealBloomPass.js` | three, Pass, CopyShader, LuminosityHighPassShader |
| `postprocessing/OutputPass.js` | three, Pass, OutputShader |
| `postprocessing/Pass.js` | three |
| `postprocessing/ShaderPass.js` | three, Pass |
| `postprocessing/MaskPass.js` | Pass |
| `shaders/CopyShader.js` | none |
| `shaders/LuminosityHighPassShader.js` | three |
| `shaders/OutputShader.js` | none |

This is the complete recursive import closure: **10 addon files**.
The local HTML import map resolves `three` and `three/addons/`. Existing direct
core imports intentionally remain compatible with the unmodified Node tests;
they resolve to the same local module URL as `three` in the browser.

`RenderPass → UnrealBloomPass → OutputPass` preserves linear HDR before a single
ACES/sRGB output transform. The official r186 `UnrealBloomPass.dispose()` omits
`materialHighPassFilter`; the application wrapper disposes that extra material
and the Composer timer without patching any upstream file.

Verify locally:

```sh
cd games/signal-stack
sha256sum -c vendor/three/SHA256SUMS
```
