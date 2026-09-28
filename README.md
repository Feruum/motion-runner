# Motion Runner

Motion Runner is a standing-play arcade game controlled by a laptop webcam. Lean to change lanes, raise both hands to jump, clear obstacle waves and chase a personal best. The repository is a Bun workspace monorepo: `apps/web` contains the Vite game, `apps/api` contains the Hono API, and `packages/game` shares the original gesture, session and game rules.

**The controls are yours:** MediaPipe supplies 33 body landmarks. Motion Runner's own gesture engine calibrates a neutral stance, normalizes for shoulder width, smooths the pose, detects movement intent, confirms gestures and diagnoses incomplete tutorial attempts.

## Play locally

Requires Bun 1.4 or newer. Camera access requires `localhost` or HTTPS.

```sh
bun install
bun run dev
```

Open the local Vite address in current desktop Chrome or Edge. `bun run dev` starts Vite and the Hono API together; Vite proxies `/api` requests to the local Bun server. Choose **Enable camera** once, allow camera access, and stand back so your head, shoulders, hips and hands are visible. Lower both hands and stand upright for two seconds to calibrate. Follow the three-step movement tutorial, returning upright with hands down between moves. On the ready screen, hold both hands above your head for one second, lower them, and wait for the three-second countdown. Video and pose processing stay in the browser. The current prototype keeps the personal-best score in local storage. Supabase has not been connected yet; `/api/health` is the initial API endpoint.

The normal build uses a 60-second round. For quick development runs, use `http://127.0.0.1:5173/?dev=1`; the short mode is enabled by Vite's development build only.

Before enabling the camera, use **Choose your runner** to preview Rogue, Knight, Mage or Barbarian from KayKit Adventurers. All four share the same controls, speed, collision rules and five animation actions. The selected character stays with you through the tutorial and replays; the choice is not stored between page visits. If an optional model fails to load, the previous runner remains available and you can choose another.

## Controls

| Movement | Result |
| --- | --- |
| Lean left | Move to the left lane |
| Return upright | Move to the center lane |
| Lean right | Move to the right lane |
| Raise both hands above your head | Jump once; lower both hands to arm another jump |
| Hold both hands up for one second, then lower them | Start a run or replay after the results screen |

A cleared wave adds 10 points. A collision removes 5 points, down to zero. A wave is scored once. The timer counts active play and freezes while body tracking recovers. High coral barriers require an open lane; low barriers can be jumped inside the safe jump window.

## Camera and recovery

- **Access denied:** allow camera access for this site in the browser and choose **Try again**.
- **Camera missing or busy:** connect the laptop camera, or close the other app using it, then retry.
- **Pose model failed to load:** check that the page can load its local `models/` and `wasm/` files, then retry.
- **Calibration stays at 0%:** lower both hands below your shoulders and stand upright without leaning for two seconds. The setup screen explains which condition is blocking calibration, and the progress bar fills as you hold the neutral pose.
- **Out of frame or weak tracking:** the course pauses. Return to the camera frame, lower both hands and wait through the recovery countdown.
- **Hidden tab:** the run pauses when the page is hidden. Return to the tab to continue.

The preview is mirrored so its directions match the player's. The skeleton highlights joints involved in tutorial corrections such as “Raise your right hand above your head.” An obstacle collision alone never labels the player's movement as wrong.

## Implementation

```text
Webcam → Pose Landmarker → timestamped landmarks
       → calibration + normalized smoothing
       → gesture intent + classification + correction
       → session controller → game simulation → Three.js scene
```

- `apps/api/src/index.ts`: Hono API entry point, local Bun server and health route. Supabase auth, persistence and leaderboard endpoints are the next backend stage.
- `apps/web/src/vision/`: one-in-flight worker inference, camera stream lifecycle and landmark transport. The worker adapts Google's official MediaPipe Web Pose Landmarker sample at revision `fa5a2eec5a6a3bed339d872dfd8d7895e1db13f7`; the changes are listed in its source header.
- `packages/game/src/core/gesture.ts`: pure gesture engine; all camera-tuning values live in `packages/game/src/core/config.ts`.
- `packages/game/src/core/session.ts`: calibration, tutorial, gesture start, countdown, tracking pause and replay.
- `packages/game/src/core/game.ts`: authored waves, one-time scoring, collisions, jumps and round duration. This package is imported by the web client and will be reused by the API for score verification.
- `apps/web/src/presentation/world.ts`: Three.js scene, KayKit Rogue, separately loaded KayKit idle/run/jump/hit/cheer clips, track, lights, particles and restrained postprocessing.
- `apps/web/src/app.ts` + `apps/web/src/styles.css`: English UI, mirrored pose overlay, accessibility, correction guidance and synthesized Web Audio cues.

Workspace dependencies are pinned in `bun.lock`. The Lite pose model, MediaPipe WASM, KayKit Rogue, the Platformer models and the separate Character Animations clips are served from `apps/web/public`. `bun run assets` prepares the asset tree and `apps/web/public/assets/manifest.json` records pinned source URLs and SHA-256 hashes. The gesture formulas and game logic are original project code. Third-party asset, library and adapted-sample notices are in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Checks

```sh
bun run test
bun run build
bun run test:e2e
```

The unit tests cover gesture calibration, lean direction and hysteresis, partial-jump feedback, held/jittered gestures, jump rearming, loss of landmarks, wave scoring, pause/resume, round finish and replay. Browser smoke tests run against the built production output, use a synthetic camera stream, and check local model/WASM/GLTF requests. They do not replace the real-webcam checklist: test each movement, intentional partial attempts, leaving/re-entering the camera frame and a full result/replay on both Chrome and Edge.

## Publishing

The GitHub Actions workflow checks the Bun workspace and publishes `apps/web/dist` to GitHub Pages on pushes to `main`. Enable Pages with **GitHub Actions** as the build source in repository settings. Pages is served over HTTPS, which permits camera access. The Vercel project and Supabase production credentials are not configured by this local monorepo change.
