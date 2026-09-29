# Rhythm Stars Implementation Plan

> Execution: subagent-driven-development. User requires GPT-6 Luna / max for every subagent.

**Goal:** Make Rhythm Run a visible star-collecting game. User chose a running character collecting low stars by leaning and high stars by jumping.

**Architecture:** Extend the existing pure ModeEngine and Three.js RunnerWorld. Shared rhythm-types.ts owns star state and pickup constants. A dedicated rhythm.ts runtime owns scoring and a rhythm-stars.ts renderer owns presentation. App connects actual runner lane/jump height, UI cues and existing audio. Preserve all parallel edits and other modes; no new dependencies, commits or deployment.

**Tech Stack:** Existing TypeScript, Three.js, Vitest and Chrome/Playwright synthetic-camera fixtures.

- [x] Engine: write failing tests for low pickup by occupied lane (including already holding it), wrong lane/no pickup, high star requires actual jump height, one-time scoring, miss/combo, reset and pause-safe snapshots. Implement RhythmRunRuntime.update(elapsedMs, RhythmFrame), snapshot(elapsedMs), reset(), finish(). Stars at 4000 ms then every 2000 ms, low left / high center / low right / high center; first 4 teach the rules. ModeEngine.rhythm is public readonly; update gains optional sixth RhythmFrame argument. Existing chart stays compatible and mirrors resolved states. Export rhythm types/runtime. Engine agent owns rhythm.ts, modes.ts, index.ts and relevant unit tests.
- [x] Renderer: add RhythmStars presentation class, attach to RunnerWorld, extend world.update with optional fifth RhythmSnapshot. Use existing yellow star asset and a geometric fallback, distinguish high stars, mark pickup plane at runnerZ, show approaching objects from shared chart, collected burst/fade and missed travel. Reset/cleanup on mode change/replay. Expose canvas data attributes for visible/collected stars and next-star metadata to let browser tests observe actual rendered scene. Renderer agent owns rhythm-stars.ts, world.ts and renderer tests.
- [x] App: root passes session.game lane/jumpHeight into rhythm scoring and shared snapshot into world. Replace vague rhythm text with star instructions; add visible legend (lean for low, jump for high), collected count, progress to pickup plane and first-four guided cues. Rewrite result explanation. Existing other modes remain unchanged.
- [x] Validation: engine and rendering tests, typecheck/build, Chrome synthetic camera collects a low and high star, intentionally misses one, confirms visible feedback and score coupling, pause freezes target positions, replay resets, narrow viewport has no overlap/overflow. Capture actual gameplay screenshot and review visible targets.

Design accepted through user's choice: “Персонажем на дорожке: наклониться к звезде, за высокой — прыгнуть”. Stars are gameplay objects, not decorative rewards for text-command edges. Scoring uses the character state at the pickup plane; holding the correct lane early is valid. No score when standing under a high star without jumping. The existing Three.js scene and asset loader are the capability owners; no custom rendering framework or dependency is needed.

Implementation complete; all four tasks validated. Full workspace check passed (221 web tests, 28 API tests, types and build). Final Chrome star collection/recovery/replay scenario passed. See `.video-review/rhythm-stars-qa.md` for scoped evidence and screenshots.

