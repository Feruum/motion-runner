# Dance Party and Duo Demonstrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Dance Solo and Duo one front-facing KayKit demonstrator, a stationary scene, and a persistent cue guide that stays aligned with the scoring runtime.

**Architecture:** Keep scoring and cue timing in `ModeEngine`; derive the guide and demonstrator target from `snapshot.poseCueIndex`. `RunnerWorld` owns the presentation mode and delegates each frame to the Dance presenter using the current cue, frame delta, and pause state. The guide keeps the target/progress visible independently from pose corrections and labels Duo feedback by player identity.

**Tech Stack:** TypeScript, Vite, Three.js, Vitest, existing KayKit GLB and Dance runtimes.

---

### Task 1: Dance guide state

**Files:** Create `apps/web/src/presentation/dance-guide-state.ts`; create `apps/web/tests/dance-guide-state.test.ts`.

- [ ] Write focused cases for cue-index-to-authored-target mapping, completed-pose progress, separate Solo feedback, and correctly labeled P1/P2 feedback.
- [ ] Have the root agent run the new test to observe the expected failure before implementation.
- [ ] Implement a pure mapper using `DANCE_CUES` and `ModeSnapshot` values; never calculate or advance cue timing in the presentation helper.

### Task 2: World and app wiring

**Files:** Modify `apps/web/src/presentation/world.ts`, `apps/web/src/app.ts`; create `apps/web/src/presentation/dance.css`.

- [ ] Add `setDanceMode` and `updateDance(cueIndex, dtSeconds, frozen)` integration; send null outside active scoring and on completion, while preserving the current cue during camera pause.
- [ ] Use existing presenter-mode scene suppression for the runner, scrolling road, obstacles, and movement particles; restore it on mode exit.
- [ ] Add a persistent Dance guide with mirror direction, half-second hold, full-body framing, routine progress, and separate Solo/Duo feedback; keep correction messages in their existing channel.
- [ ] Hide Dance guide during countdown/results and surface it during active play; leave session pause/replay and scoring transitions unchanged.

### Task 3: User-facing documentation and root validation

**Files:** Update `README.md`; retain this plan as the implementation record.

- [ ] Document Solo/Duo demonstrator behavior, screen-side mirroring, the 0.5-second hold, full-body framing, and Duo’s shared cue with separate player results.
- [ ] Ask the root agent to run the focused unit tests, type/build checks, E2E and actual-GLB visual validation after both presentation slices land.

