# Camera recovery and gameplay feedback

**Goal:** Fix the tracking interruptions and unclear recovery/replay feedback seen in the supplied recording.

**Design:** Track the head and torso independently from wrists. Require visible wrists for hand gestures and calibration; never invent a jump from missing landmarks. Preserve lean state through short occlusions. Hold simulation during brief body-tracking gaps, enter the pause screen only after 300 ms, and recover with 400 ms of stable body tracking plus a one-second countdown. Initial starts retain the three-second countdown. Ignore hand position during recovery and discard jump events consumed during countdown.

**Scope:** Existing local checkout, preserving all pre-existing changes. No dependency changes. Keep collision scoring unchanged; add readable barrier markings, live approach guidance, collision feedback and explicit replay progress/button.

**Verification:** Synthetic landmark regression tests, full existing unit suite, TypeScript/production build, existing browser smoke tests and a synthetic-camera flow covering clipping, pause/recovery, results and replay. Real webcam validation remains a separate hardware check.

- [x] Add failing regressions for clipped wrists, invalid landmarks, preserved lean, short body gaps, recovery countdown, gesture rearming and button replay.
- [x] Update `gesture.ts`, `session.ts`, `config.ts`, `types.ts` and fixtures; run focused tests.
- [x] Update `app.ts` and existing presentation styles for specific tracking guidance, state-appropriate cues and replay feedback.
- [x] Differentiate low mint and tall coral barriers; add approach/collision cues with unit/browser coverage.
- [x] Run the full unit suite, production build and browser checks; inspect screenshots and review the diff.

## Verification and concurrent-work boundary

- The focused six-file unit suite passed 53 tests. The 10 added gesture/session regressions were observed failing before their fixes.
- Browser recovery flow passed with a synthetic camera: clipped wrists retain steering, actual body loss pauses, score is preserved on recovery, results show hold progress, button replay and gesture replay each start a fresh run. Desktop and 390px result screenshots inspected; corrected the mobile HUD's vertical positioning.
- Production Vite bundling passed. Full test/TypeScript checks were run but are not green: the user confirmed concurrent work, and the Mirror Challenge test/source interface is changing. Do not alter that work as part of this fix.
- A neighbouring Rhythm browser check still fails to score its first cue. The concurrently edited mode now previews the cue 2000 ms early but only accepts an edge within 360 ms of the beat; preserve those timing edits for their owner. Six-Seven browser flow passes after replacing the test's fixed start delay with the visible hand-acceptance condition.
- Browser tests use a synthetic webcam, not a real camera. The recording's physical camera setup still needs a real-device replay.
