# Motion Runner

Motion Runner is a standing-play arcade prototype controlled by a laptop webcam. Lean to change lanes, raise both hands to jump, clear obstacle waves and chase a local personal best.

**The controls are yours:** MediaPipe supplies 33 body landmarks. Motion Runner's own gesture engine calibrates a neutral stance, normalizes for shoulder width, smooths the pose, detects movement intent, confirms gestures and diagnoses incomplete tutorial attempts.

## Play locally

Requires Node.js 22 or newer and npm. Camera access requires `localhost` or HTTPS.

```sh
npm ci
npm run dev
```

Open the local Vite address in current desktop Chrome or Edge. Choose **Enable camera** once, allow camera access, stand back so your head, shoulders and hips are visible, then follow the three-step movement tutorial. Video and pose processing stay in the browser. Only the personal-best score is saved in local storage.

The normal build uses a 60-second round. For quick development runs, use `http://127.0.0.1:5173/?dev=1`; the short mode is enabled by Vite's development build only.

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

- `src/vision/`: one-in-flight worker inference, camera stream lifecycle and landmark transport. The worker adapts Google's official MediaPipe Web Pose Landmarker sample at revision `fa5a2eec5a6a3bed339d872dfd8d7895e1db13f7`; the changes are listed in its source header.
- `src/core/gesture.ts`: the pure gesture engine; all camera-tuning values live in `src/core/config.ts`.
- `src/core/session.ts`: calibration, tutorial, gesture start, countdown, tracking pause and replay.
- `src/core/game.ts`: authored waves, one-time scoring, collisions, jumps and round duration.
- `src/presentation/world.ts`: Three.js scene, KayKit Rogue, separately loaded KayKit idle/run/jump/hit/cheer clips, track, lights, particles and restrained postprocessing.
- `src/app.ts` + `src/styles.css`: English UI, mirrored pose overlay, accessibility, correction guidance and synthesized Web Audio cues.

Dependencies are pinned in `package-lock.json`. The Lite pose model, MediaPipe WASM, KayKit Rogue, the Platformer models and the separate Character Animations clips are served from this project. `npm run assets` prepares the asset tree and `public/assets/manifest.json` records pinned source URLs and SHA-256 hashes. The gesture formulas and game logic are original project code. Third-party asset, library and adapted-sample notices are in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Checks

```sh
npm test
npm run build
npm run test:e2e
```

The unit tests cover gesture calibration, lean direction and hysteresis, partial-jump feedback, held/jittered gestures, jump rearming, loss of landmarks, wave scoring, pause/resume, round finish and replay. Browser smoke tests run against the built production output, use a synthetic camera stream, and check local model/WASM/GLTF requests. They do not replace the real-webcam checklist: test each movement, intentional partial attempts, leaving/re-entering the camera frame and a full result/replay on both Chrome and Edge.

## Publishing

The GitHub Actions workflow tests the production build and deploys `dist/` to GitHub Pages on pushes to `main`. Enable Pages with **GitHub Actions** as the build source in repository settings. Pages is served over HTTPS, which permits camera access.

