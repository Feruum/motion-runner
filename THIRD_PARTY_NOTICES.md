# Third-party notices

Motion Runner combines original gesture, session and game logic with the following open-source libraries and freely licensed assets. Asset downloads are pinned in `scripts/prepare-assets.mjs`; `public/assets/manifest.json` records the source and SHA-256 of each downloaded file.

## Runtime libraries

| Project | Pinned version | License | Use |
| --- | --- | --- | --- |
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) | `@mediapipe/tasks-vision` 1.0.1 | Apache-2.0 | Pose Landmarker inference and bundled WASM runtime |
| [Three.js](https://github.com/mrdoob/three.js) | 0.186.1 | MIT | WebGL scene, animation, lighting and GLTF loading |
| [postprocessing](https://github.com/pmndrs/postprocessing) | 6.39.5 | Zlib | SMAA and low-intensity bloom |
| [three.quarks](https://github.com/Alchemist0823/three.quarks) | 0.17.1 | MIT | Short landing and clear particles |
| [Motion](https://github.com/motiondivision/motion) | 13.4.4 | MIT | Score micro-animation |
| [Outfit](https://github.com/Outfitio/Outfit-Fonts) | 5.3.0 | SIL Open Font License 1.1 | Display typography |
| [DM Sans](https://github.com/googlefonts/dm-fonts) | 5.3.0 | SIL Open Font License 1.1 | Interface typography |

All runtime package versions are exact and recorded in `package-lock.json`. The package distributions contain their corresponding license files.

## 3D assets

### KayKit Adventurers Character Pack

The hooded Rogue GLB and character texture in `public/assets/character/` come from Kay Lousberg's [KayKit Adventurers Character Pack](https://kaylousberg.itch.io/kaykit-adventurers). Source revision: [`672074b73ba276876a19e8816ecdc5241817ab47`](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/tree/672074b73ba276876a19e8816ecdc5241817ab47). The creator supplies the pack under CC0-1.0; the supplied notice is retained at `public/assets/character/LICENSE.txt`.

### KayKit Platformer Pack

The blue platform, arch and flag; red low/high barriers; and yellow star models in `public/assets/platformer/` come from Kay Lousberg's [KayKit Platformer Pack](https://kaylousberg.itch.io/kaykit-platformer). Files are pinned to mirror revision [`f8206b38e4355a8b2a490e3032000d2a84883a0f`](https://github.com/series-ai/jam-ready-assets/tree/f8206b38e4355a8b2a490e3032000d2a84883a0f). The creator's CC0-1.0 notice is retained at `public/assets/platformer/LICENSE.txt`.

### KayKit Character Animations

The [KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) pack is downloaded separately to `public/assets/animations/`. Motion Runner uses `Idle_A`, `Running_A`, `Jump_Full_Short`, `Hit_A`, and `Cheering` (mapped to the local action name `Cheer`) from the `Rig_Medium_General`, `Rig_Medium_MovementBasic`, and `Rig_Medium_Simulation` GLB sets. Their bone names match the Rogue skeleton, so Three.js applies these clips directly to the character. The files and CC0 license notice are pinned to the same mirror revision above; the supplied notice is retained at `public/assets/animations/LICENSE.txt`.

## Pose model

`public/models/pose_landmarker_lite.task` is Google's official Pose Landmarker Lite model, downloaded from the public MediaPipe model endpoint. Its model card identifies Apache-2.0 as the license. The WASM runtime is copied from the exact Apache-2.0 npm package version above. See the [official web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) and the [Pose Landmarker model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) for model and API information.

## Adapted MediaPipe Web sample

`src/vision/pose.worker.ts` adapts the official MediaPipe Web Pose Landmarker worker sample at revision [`fa5a2eec5a6a3bed339d872dfd8d7895e1db13f7`](https://github.com/google-ai-edge/mediapipe-samples-web/blob/fa5a2eec5a6a3bed339d872dfd8d7895e1db13f7/src/workers/pose-landmarker.worker.ts). The upstream Apache-2.0 license is retained at `third_party/licenses/mediapipe-samples-web-LICENSE`. The worker narrows the sample to one-person VIDEO inference, transfers local camera frames with a one-frame-in-flight limit, loads same-origin files, and retries initialization on CPU when the GPU delegate is unavailable.

No game project or gesture-recognition implementation is forked. Motion Runner's track composition, gesture analysis and scoring are authored for this project.

