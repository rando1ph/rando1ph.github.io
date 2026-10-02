# Signal Stack — Phase 4 release candidate

The accepted Phase 1 gameplay and Phase 3 visual direction are preserved.
Final production audio, lifecycle, input and resilience work is documented in
[docs/final-report.md](docs/final-report.md). Physical phone acceptance is
[pending](docs/physical-device-checklist.md).

From the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/games/signal-stack/>. No install, build step, CDN or
backend. WebGL 2 is required. Tap/click, Space or Enter drops the suspended
module; three failed placements end the run. Reconnect starts a fresh run
without reloading. Sound uses the repository preference `randolf:games:sound`.

Run all non-browser tests:

```sh
node --test games/signal-stack/tests.mjs games/signal-stack/render-tests.mjs games/signal-stack/visual-tests.mjs games/signal-stack/production-tests.mjs
```

Optional browser QA needs Python Playwright and `/usr/bin/google-chrome`, plus
the server above. It writes local, ignored artifacts to `qa/`:

```sh
python3 games/signal-stack/browser-checks.py
python3 games/signal-stack/production-browser-checks.py
python3 games/signal-stack/resilience-browser-checks.py
python3 games/signal-stack/visual-browser-checks.py
python3 games/signal-stack/quality-browser-checks.py
python3 games/signal-stack/render-browser-checks.py --no-bloom
python3 games/signal-stack/render-browser-checks.py --lifecycle-only
```

The visual/quality harnesses retain their historical `phase3-*` artifact names;
the final report records which runs were repeated during Phase 4.

Gameplay adapted from [iamkun/tower_game](https://github.com/iamkun/tower_game)
under [MIT](LICENSE-tower-game.txt). Three.js is pinned to **r186** with local
core/addons, [MIT license](LICENSE-three.txt), and
[provenance/checksums](vendor/three/README.md). Historical visual implementation
notes: [Phase 3 report](docs/phase3-report.md).

This candidate remains in the working tree for the larger multi-game batch.
It has not been added to `games/index.html`, committed, pushed or deployed.
