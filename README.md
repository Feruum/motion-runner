# Motion Runner

Motion Runner is a standing-play arcade game controlled by a laptop webcam. Lean to change lanes, raise both hands to jump, clear obstacle waves and chase a personal best. The repository is a Bun workspace monorepo: `apps/web` contains the Vite game, `apps/api` contains the Hono API, and `packages/game` shares the original gesture, session and game rules.

**The controls are yours:** MediaPipe supplies 33 body landmarks. Motion Runner's own gesture engine calibrates a neutral stance, normalizes for shoulder width, smooths the pose, detects movement intent, confirms gestures and diagnoses incomplete tutorial attempts.

## Play locally

Requires Bun 1.4 or newer. Camera access requires `localhost` or HTTPS.

```sh
bun install
bun run dev
```

Open the Vite address printed in the terminal in current desktop Chrome or Edge. `bun run dev` starts Vite and the Hono API together; Vite proxies `/api` requests to the local Bun server on port 3002 (override with `API_PORT` if needed). Vite starts at port 5175 and automatically selects the next free port if needed. Choose **Enable camera** once, allow camera access, and stand back so your head, shoulders, hips and hands are visible. Lower both hands and stand upright for two seconds to calibrate. Follow the three-step movement tutorial, returning upright with hands down between moves. On the ready screen, hold both hands above your head for one second, lower them, and wait for the three-second countdown. Video and pose processing stay in the browser. The **Leaderboard** link in the top bar opens the Classic Run top five. A completed run submits the runner name and score to the Hono API, which stores one best result per player in local SQLite by default. Personal best also remains in browser storage.

## Party Race

Choose **Party Race** in the mode picker (or open `?mode=party-race`). **Play with bots** runs a local eight-runner race without an API connection. **Create room** and **Join room** use the Bun server for a private race with friends; share the displayed six-character room code or invitation link. Every human calibrates their own camera, learns steering and jumping, and selects **Ready to race**. The host starts the three-second countdown. Bot fill can be disabled in the lobby.

Party Race uses continuous lateral steering: lean to move sideways and return upright to hold your line. Raise both hands to jump, then lower them before the next jump. Pass moving gates, jump sweeping beams and gaps, and use checkpoint flags after falls. The 480 m course has a 120-second limit. Results show place and finish time; they are separate from the Classic Run leaderboard. **Race again** returns everyone to the same room.

Camera video and landmarks stay local. Online clients send steering, jump and tracking state; the server simulates collisions, bots, checkpoints and finish order. Camera loss stops only your racer while the room keeps racing. A lost network connection automatically attempts to resume the same player for up to ten seconds. The host role moves to another connected human when needed. Rooms are in-memory and are lost when the server restarts.

Local development proxies `/api/race` WebSockets through Vite to the API on port 3002. For a separately hosted API, set `VITE_RACE_SERVER_URL=https://your-api-host` before building the web app (or supply a complete `wss://.../api/race` URL). HTTPS pages require WSS. Internet rooms need one persistent Bun server behind HTTPS/WSS with WebSocket upgrades enabled; static GitHub Pages alone supports the offline bot option. The initial implementation uses one server process with in-memory rooms, without public matchmaking or persistent race rankings.

Run `bun run --filter @motion-runner/web test:race` for the dedicated Chrome checks. This starts isolated API and Vite servers on ports 4192 and 4188, tests the real WebSocket room with two independent synthetic cameras and six bots, and checks replay and reconnection. It does not replace testing physical webcams on the target devices.

## Optional Supabase leaderboard

The API uses SQLite locally unless `LEADERBOARD_STORAGE=supabase` is set. To use Supabase, create a project, run [`supabase/migrations/202609290001_leaderboard.sql`](./supabase/migrations/202609290001_leaderboard.sql) once in its SQL Editor, then copy `apps/api/.env.example` to `apps/api/.env` and set `LEADERBOARD_STORAGE=supabase`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`. Restart the API after changing its environment. The secret key is used only by Hono; do not add a `VITE_` prefix, commit `.env`, or put it in browser code. The migration enables RLS, gives browser roles no table access, exposes ranked rows only to the API role, and updates a player's stored score atomically only when it improves. The leaderboard is shared only while the Hono API is reachable; a static GitHub Pages build does not host the API.

The normal build uses a 60-second round. For quick development runs, add `?dev=1` to the Vite address printed in the terminal; the short mode is enabled by Vite's development build only.

Before enabling the camera, use **Choose your runner** to preview Rogue, Knight, Mage or Barbarian from KayKit Adventurers. All four share the same controls, speed, collision rules and five animation actions. The selected character stays with you through the tutorial and replays; the choice is not stored between page visits. If an optional model fails to load, the previous runner remains available and you can choose another.

## The wild path

Each run travels through three landscapes: **Sunlit Valley** (river, village and windmill), **Forest Crossing** (trees and a wooden path), and **Ancient Gateway** (stone columns, banners and the finish). Transitions follow active round time, including the 20-second development mode. Tracking pauses freeze the scenery; replay returns to the valley. The game expands to fill the viewport during a run, with a compact camera preview and large score/timer.

These landscapes use 18 ready-made CC0 KayKit models from the Forest Nature, Medieval Hexagon and Dungeon packs, alongside the existing Platformer barriers and Adventurers characters. Models, buffers and textures are served locally. Trees and roadside props are instanced and recycled behind the camera; the finish approaches during the last part of the run. Lighting, atmospheric depth, moving clouds, windmill blades, water highlights and short jump/landing particles complete the scene. If the renderer averages more than 40 ms per frame across 180 frames after scenery loads, it reduces pixel density, disables postprocessing/shadows and reduces ambient effects. Actual webcam performance still needs checking on the demo laptop.

## Controls

| Movement | Result |
| --- | --- |
| Lean left | Move to the left lane |
| Return upright | Move to the center lane |
| Lean right | Move to the right lane |
| Raise both hands above your head | Jump once; lower both hands to arm another jump |
| Hold both hands up for one second, then lower them | Start a run or replay after the results screen |

A cleared wave adds 10 points. A collision removes 5 points, down to zero. A wave is scored once, including after tracking recovery. The timer counts active play and freezes while body tracking recovers. High coral barriers require an open lane; low mint barriers can be jumped inside the safe jump window. The in-game cue indicates when to raise both hands, when to change lanes, and when a collision occurs. Lower both hands between jumps to prepare another one.

## Camera and recovery

- **Access denied:** allow camera access for this site in the browser and choose **Try again**.
- **Camera missing or busy:** connect the laptop camera, or close the other app using it, then retry.
- **Pose model failed to load:** check that the page can load its local `models/` and `wasm/` files, then retry.
- **Calibration stays at 0%:** lower both hands below your shoulders and stand upright without leaning for two seconds. The setup screen explains which condition is blocking calibration, and the progress bar fills as you hold the neutral pose.
- **Hands out of frame:** steering remains available while the head and torso are tracked. Hand gestures require both wrists in view; bend your elbows or step back to leave room above your head. Lower both hands before trying another jump.
- **Body out of frame or weak tracking:** the course holds its position immediately. Gaps shorter than 300 ms recover without opening the pause screen. Longer gaps show which body landmarks are missing. After 400 ms of stable body tracking, a one-second countdown resumes the same course and score; lowering your hands is not required for recovery.
- **Hidden tab:** the run pauses when the page is hidden. Return to the tab to continue.

The preview is mirrored so its directions match the player's. The skeleton highlights joints involved in tutorial corrections such as “Raise your right hand above your head.” An obstacle collision alone never labels the player's movement as wrong.

The result screen shows the hand-hold progress and confirms when to lower your hands for a replay. You can also choose **Run again** while your body is tracked. New runs keep the three-second preparation countdown.

## Implementation

```text
Webcam → Pose Landmarker → timestamped landmarks
       → calibration + normalized smoothing
       → gesture intent + classification + correction
       → session controller → game simulation → Three.js scene
```

- `apps/api/src/index.ts` + `apps/api/src/app.ts`: Hono API startup, health route and validated leaderboard read/write endpoints. Storage defaults to local SQLite; `apps/api/src/sqlite-leaderboard-store.ts` and `apps/api/src/supabase-leaderboard-store.ts` implement the same tested store contract. Supabase settings are server-only.
- `supabase/migrations/202609290001_leaderboard.sql`: leaderboard table, ranking view, atomic best-score function and least-privilege grants for Supabase.
- `apps/web/src/leaderboard.ts`: browser requests for the local top-five board and completed-run submission. Only the runner name and game result leave the browser; webcam video stays local.
- `apps/web/src/vision/`: one-in-flight worker inference, camera stream lifecycle and landmark transport. The worker adapts Google's official MediaPipe Web Pose Landmarker sample at revision `fa5a2eec5a6a3bed339d872dfd8d7895e1db13f7`; the changes are listed in its source header.
- `packages/game/src/core/gesture.ts`: pure gesture engine; all camera-tuning values live in `packages/game/src/core/config.ts`.
- `packages/game/src/core/session.ts`: calibration, tutorial, gesture start, countdown, tracking pause and replay.
- `packages/game/src/core/game.ts`: authored waves, one-time scoring, collisions, jumps and round duration. This package is imported by the web client and will be reused by the API for score verification.
- `apps/web/src/presentation/world.ts`: Three.js scene, KayKit Rogue, separately loaded KayKit idle/run/jump/hit/cheer clips, track, lights, particles and restrained postprocessing.
- `apps/web/src/presentation/environment.ts` + `route.ts`: instanced KayKit scenery, three landscape compositions, active-time transitions and the approaching finish. `journey.css` provides the brighter scene treatment and focused gameplay layout.
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

The GitHub Actions workflow checks the Bun workspace and publishes `apps/web/dist` to GitHub Pages on pushes to `main`. Enable Pages with **GitHub Actions** as the build source in repository settings. Pages is served over HTTPS, which permits camera access. GitHub Pages serves only the static game; a shared Supabase leaderboard still needs the Hono API deployed somewhere reachable, with the Supabase secret configured on that API host. Do not use the local SQLite file for serverless production because it is not shared durable storage ([Vercel SQLite guidance](https://vercel.com/kb/guide/is-sqlite-supported-on-vercel)).
