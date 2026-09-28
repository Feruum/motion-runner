export const CONFIG = Object.freeze({
  durationMs: 60000, developmentDurationMs: 20000,
  calibrationMs: 2000, calibrationMaxDeviation: 0.045,
  confidence: 0.6, smoothingMs: 80,
  leanActivate: 0.22, leanRelease: 0.12, leanPartial: 0.08, leanHoldMs: 120,
  handsHoldMs: 100, headMargin: 0.20, correctionDelayMs: 500, correctionRepeatMs: 2000,
  jumpMs: 900, jumpSafeStartMs: 150, jumpSafeEndMs: 750,
  firstWaveMs: 5000, waveIntervalMs: 2500, wavePreviewMs: 3000,
  runnerZ: 0, obstacleSpawnZ: -14, obstacleExitMs: 900,
  staleMs: 300, trackingGraceMs: 300, recoveryMs: 1000, recoveryCountdownMs: 1000, startHoldMs: 1000, countdownMs: 3000,
  tutorialConfirmMs: 650, maxInferenceHz: 20,
});
export const POINT = { nose: 0, leftEye: 2, rightEye: 5, leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24 } as const;
