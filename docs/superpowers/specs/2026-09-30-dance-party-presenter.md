# Dance Party Solo and Duo Presenter

## Product behavior

- Solo and Duo use the selected KayKit character as one front-facing demonstrator on a stationary platform.
- Dance hides the ordinary runner, moving road, obstacles, and running-footstep effects.
- The current pose is always the authored scoring cue indexed by `ModeSnapshot.poseCueIndex`. Presentation adds no demo phase or independent cue clock.
- During countdown and completion the demonstrator stays neutral. Camera recovery freezes the current target and pose. Replay starts at the first scoring cue; leaving Dance restores the normal runner scene.
- A persistent guide names the target, shows routine progress, and explains mirror direction, the 0.5-second hold, and full-body framing. Corrections remain in a separate guide region and cannot replace the target.
- Duo shares one demonstrator and one target. Player 1 and Player 2 feedback and scores remain individually labeled; synchronized cues continue to use the existing team bonus.

## Boundaries

- Do not change Dance scoring, cue duration, hold duration, pause/replay transitions, camera identity assignment, or result calculations.
- Keep the selected KayKit rig and the existing scoring `DANCE_CUES` as the source of displayed cues.
- Validate desktop and mobile framing against the actual loaded GLB; synthetic poses establish behavior, not camera-recognition accuracy.
