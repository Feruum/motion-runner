import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { Landmark, PoseSample } from '@motion-runner/game';
import { DANCE_CUES } from '../../../../packages/game/src/core/dance';
import { pose } from '../fixtures';
import { danceDuoSample, dancePose } from './dance-fixtures';

const poseModes = ['mirror-challenge', 'dance-party', 'dance-duo'] as const;
type PoseMode = typeof poseModes[number];

for (const mode of poseModes) {
  test(`${mode} completes the camera flow, scores a pose, and replays`, async ({ page }, testInfo) => {
    test.setTimeout(130_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/leaderboard**', route => route.fulfill({
      json: { mode: 'classic-run', entries: [], personalBest: null },
    }));
    await installPoseFixture(page, mode === 'dance-duo');

    await page.goto('/');

    await expect(page.locator(`[data-mode="${mode}"]`)).toBeVisible();
    await page.locator(`[data-mode="${mode}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-selected-mode', mode);
    await expect(page.locator('#timer')).toHaveText('01:00');
    const character = mode === 'dance-duo' ? 'Knight' : 'Rogue';
    const characterId = character.toLowerCase();
    const picker = page.getByRole('group', { name: 'Choose your runner' });
    await expect(picker).toBeVisible();
    if (character === 'Knight') await picker.getByRole('button', { name: character, exact: true }).click();
    await expect(page.locator('#game-world')).toHaveAttribute('data-character', characterId);
    await expect(page.locator('#game-world')).toHaveAttribute('data-mirror-coach-character', characterId);
    await page.getByRole('button', { name: 'Enable camera' }).click();

    await completeSharedTutorial(page, mode, testInfo);

    if (mode === 'mirror-challenge') {
      // The first assignment is a short demo followed by a five-second attempt.
      // Holding a clear left lean through both phases must resolve the first task.
      await setModePose(page, mode, pose(0, -0.4));
      await expect.poll(async () => readScore(page), { timeout: 6000, intervals: [100, 150, 250] }).toBeGreaterThan(0);
      await expect(page.locator('#mode-cue-title')).toContainText(/pose|complete|next/i, { timeout: 3000 });
    } else if (mode === 'dance-party') {
      const firstTarget = page.locator('#dance-target');
      const correction = page.locator('#dance-solo-correction');
      await expect(page.locator('#dance-guide')).toHaveAttribute('data-cue-index', '0');
      await expect(firstTarget).toHaveText(DANCE_CUES[0].name);
      await setModePose(page, mode, dancePose(1));
      await expect(correction).toBeVisible();
      await expect(firstTarget).toHaveText(DANCE_CUES[0].name);
      await setModePose(page, mode, dancePose(0));
      await expect.poll(async () => readScore(page), { timeout: 5000, intervals: [100, 150, 250] }).toBeGreaterThan(0);
      await expect(correction).toHaveText('Cue complete — get ready for the next move');
      expect(await page.evaluate(() => {
        const target = document.querySelector('#dance-target');
        const feedback = document.querySelector('#dance-correction');
        return !!target && !!feedback && target !== feedback && !target.contains(feedback);
      })).toBe(true);
    } else {
      const target = page.locator('#dance-target');
      const playerOneCorrection = page.locator('#dance-player-one-correction');
      const playerTwoCorrection = page.locator('#dance-player-two-correction');
      await expect(page.locator('#dance-guide')).toHaveAttribute('data-cue-index', '0');
      await expect(target).toHaveText(DANCE_CUES[0].name);
      // Both people miss the target differently while detections arrive right-to-left.
      await setModePose(page, mode, danceDuoSample(1, { reversed: true }));
      await expect(page.locator('#camera-status')).toHaveAttribute('data-player-count', '2');
      await expect(playerOneCorrection).toBeVisible();
      await expect(playerTwoCorrection).toBeVisible();
      await expect(target).toHaveText(DANCE_CUES[0].name);
      const firstCorrections = [await playerOneCorrection.textContent(), await playerTwoCorrection.textContent()];

      // Reversing detector order must keep each correction on the same person.
      await setModePose(page, mode, danceDuoSample(1));
      await expect(playerOneCorrection).toHaveText(firstCorrections[0]!);
      await expect(playerTwoCorrection).toHaveText(firstCorrections[1]!);

      const scoreBeforePause = await readScore(page);
      await setModePose(page, mode, danceDuoSample(1, { missingPlayer: 2 }));
      await expect(page.locator('#camera-status')).toHaveAttribute('data-player-count', '1', { timeout: 3000 });
      await expect(page.locator('body')).toHaveAttribute('data-stage', 'PAUSED', { timeout: 3000 });
      const timerDuringPause = await page.locator('#timer').textContent();
      await page.waitForTimeout(400);
      await expect(page.locator('#timer')).toHaveText(timerDuringPause!);
      await expect(page.locator('#score')).toHaveText(scoreText(scoreBeforePause));

      // Restore both detections in the opposite order. Recovery must wait for a
      // stable frame, preserve score, and then return to the live round.
      await setModePose(page, mode, duoSample(centeredPose(0.34), centeredPose(0.66), true));
      await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 7000 });
      await expect(page.locator('#score')).toHaveText(scoreText(scoreBeforePause));
      // Keep cue 0 neutral after recovery so the authored-cue loop owns its score.
      await setModePose(page, mode, pose(0));
    }

    const earnedScore = await readScore(page);
    if (mode !== 'dance-duo') expect(earnedScore).toBeGreaterThan(0);
    if (mode !== 'dance-duo') {
      await setModePose(page, mode, { ...pose(0), landmarks: [] });
      await expect(page.locator('body')).toHaveAttribute('data-stage', 'PAUSED');
      const timer = await page.locator('#timer').textContent();
      await page.waitForTimeout(400);
      await expect(page.locator('#timer')).toHaveText(timer!);
      await setModePose(page, mode, pose(0));
      await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 7000 });
      await expect(page.locator('#score')).toHaveText(scoreText(earnedScore));
    }
    if (mode === 'dance-party' || mode === 'dance-duo') {
      const firstCueIndex = mode === 'dance-party' ? 1 : 0;
      if (mode === 'dance-party') {
        await page.screenshot({
          path: testInfo.outputPath(`dance-${mode}-${characterId}-cue-01-${DANCE_CUES[0].id}.png`),
        });
      }
      await scoreAuthoredDanceCues(page, mode, characterId, testInfo, firstCueIndex);
      expect(await readScore(page)).toBeGreaterThan(0);
    }
    await expect(page.locator('.stage-results')).toBeVisible({ timeout: 70_000 });
    await expect(page.locator('.results-metrics')).toContainText(/SCORE/i);
    // Later cues may also match the held fixture pose during the full minute.
    expect(await readScore(page)).toBeGreaterThanOrEqual(earnedScore);
    await expect(page.locator('#timer')).toHaveText('00:00');
    if (mode === 'dance-party') await expect(page.locator('.stage-results')).toContainText('matched 8 of 8');
    if (mode === 'dance-duo') await expect(page.locator('.stage-results')).toContainText('synchronized 8 phrases');
    if (mode !== 'dance-duo') {
      const totals = await page.locator('.results-metrics strong').allTextContents();
      expect.soft(Number(totals[1]) + Number(totals[2]), 'Every one of the eight tasks must be hit or missed').toBe(8);
    }
    await page.screenshot({ path: testInfo.outputPath(`${mode}-results.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#replay-run')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${mode}-mobile.png`) });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Replay uses the same body gesture as the first start: hold both hands up,
    // then lower them to begin a fresh countdown.
    await setModePose(page, mode, pose(0, 0, 'up'));
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100', { timeout: 3000 });
    await setModePose(page, mode, pose(0));
    await expect(page.locator('body')).toHaveAttribute('data-stage', 'COUNTDOWN', { timeout: 3000 });
    await expect(page.locator('#score')).toHaveText('000');
    await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
    await expect(page.locator('#score')).toHaveText('000');
    expect(pageErrors).toEqual([]);
  });
}

test('the release picker lists the three pose modes together', async ({ page }) => {
  await page.goto('/');
  for (const mode of poseModes) await expect(page.locator(`[data-mode="${mode}"]`)).toBeVisible();
});

async function installPoseFixture(page: Page, duo: boolean): Promise<void> {
  await page.addInitScript(initial => {
    const fixture: { sample: PoseSample } = { sample: initial };
    const diagnostics = {
      workerFrames: 0,
      lastWorkerAt: 0,
      lastWorkerTimestamp: 0,
      maxWorkerGapMs: 0,
      workerGapsOver300Ms: 0,
      rafFrames: 0,
      lastRafAt: 0,
      maxRafGapMs: 0,
      rafGapsOver250Ms: 0,
      longTasks: [] as Array<{ startTime: number; duration: number }>,
      stages: [] as Array<{ at: number; stage: string }>,
    };
    Object.assign(window, { poseFixture: fixture, __poseDiagnostics: diagnostics });
    try {
      new PerformanceObserver(entries => {
        for (const entry of entries.getEntries()) diagnostics.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* Long-task timing is not available in every browser build. */ }
    const trackRaf = (now: number) => {
      if (diagnostics.lastRafAt > 0) {
        const gap = now - diagnostics.lastRafAt;
        diagnostics.maxRafGapMs = Math.max(diagnostics.maxRafGapMs, gap);
        if (gap > 250) diagnostics.rafGapsOver250Ms += 1;
      }
      diagnostics.lastRafAt = now;
      diagnostics.rafFrames += 1;
      requestAnimationFrame(trackRaf);
    };
    requestAnimationFrame(trackRaf);
    const observeStages = () => {
      if (!document.body) return;
      let lastStage = document.body.dataset.stage ?? '';
      diagnostics.stages.push({ at: performance.now(), stage: lastStage });
      new MutationObserver(() => {
        const stage = document.body.dataset.stage ?? '';
        if (stage !== lastStage) {
          lastStage = stage;
          diagnostics.stages.push({ at: performance.now(), stage });
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['data-stage'] });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeStages, { once: true });
    else observeStages();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
      return canvas.captureStream(24);
    } });
    class PoseWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage(message: { type: string; timestampMs?: number; bitmap?: ImageBitmap }) {
        if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
        if (message.type === 'frame') {
          const now = performance.now();
          if (diagnostics.lastWorkerAt > 0) {
            const gap = now - diagnostics.lastWorkerAt;
            diagnostics.maxWorkerGapMs = Math.max(diagnostics.maxWorkerGapMs, gap);
            if (gap > 300) diagnostics.workerGapsOver300Ms += 1;
          }
          diagnostics.workerFrames += 1;
          diagnostics.lastWorkerAt = now;
          diagnostics.lastWorkerTimestamp = message.timestampMs ?? 0;
          message.bitmap?.close();
          const sample = structuredClone(fixture.sample);
          queueMicrotask(() => this.onmessage?.({ data: {
            type: 'pose', sample: { ...sample, timestampMs: message.timestampMs ?? 0 },
          } }));
        }
      }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { value: PoseWorker });
  }, duo ? duoSample(centeredPose(0.34), centeredPose(0.66), true) : pose(0));
}

async function completeSharedTutorial(page: Page, mode: PoseMode, testInfo: TestInfo): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Lean into the left lane.' })).toBeVisible({ timeout: 12_000 });
  await setModePose(page, mode, pose(0, -0.35));
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setModePose(page, mode, pose(0));
  await expect(page.getByRole('heading', { name: 'Now find the right lane.' })).toBeVisible();
  await setModePose(page, mode, pose(0, 0.35));
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setModePose(page, mode, pose(0));
  await expect(page.getByRole('heading', { name: 'Lift off with both hands.' })).toBeVisible();
  await setModePose(page, mode, pose(0, 0, 'up'));
  await expect(page.locator('.stage-ready')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Great. Hands down.' })).toBeVisible({ timeout: 3000 });
  await setModePose(page, mode, pose(0));
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'COUNTDOWN');
  await page.screenshot({ path: testInfo.outputPath(`${mode}-countdown-first-look.png`) });
  try {
    await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath(`${mode}-countdown-pause-debug.png`) });
    const diagnostics = await page.evaluate(() =>
      (window as unknown as { __poseDiagnostics?: unknown }).__poseDiagnostics ?? null,
    );
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nPose camera/frame diagnostics: ${JSON.stringify(diagnostics)}`);
  }
}

async function setModePose(page: Page, mode: PoseMode, sample: PoseSample): Promise<void> {
  const value = mode === 'dance-duo' && !sample.players
    ? duoSample(atCenter(sample, 0.34), atCenter(sample, 0.66))
    : sample;
  await page.evaluate((next: PoseSample) => {
    (window as unknown as { poseFixture: { sample: PoseSample } }).poseFixture.sample = next;
  }, value);
}

function centeredPose(centerX: number): PoseSample {
  return atCenter(pose(0), centerX);
}

function atCenter(sample: PoseSample, centerX: number): PoseSample {
  const delta = centerX - 0.5;
  return { ...sample, landmarks: sample.landmarks.map(point => ({ ...point, x: point.x + delta })) };
}

function reachLeftPose(centerX = 0.5): PoseSample {
  const sample = centeredPose(centerX);
  const landmarks = sample.landmarks;
  const shoulderCenterX = (landmarks[11].x + landmarks[12].x) / 2;
  const shoulderCenterY = (landmarks[11].y + landmarks[12].y) / 2;
  const hipCenterX = (landmarks[23].x + landmarks[24].x) / 2;
  const torsoLength = Math.hypot(
    shoulderCenterX - hipCenterX,
    shoulderCenterY - (landmarks[23].y + landmarks[24].y) / 2,
  );
  landmarks[15] = { ...landmarks[15], x: hipCenterX + 0.92 * torsoLength, y: shoulderCenterY };
  landmarks[13] = midpoint(landmarks[11], landmarks[15]);
  landmarks[16] = { ...landmarks[16], x: hipCenterX - 0.36 * torsoLength, y: shoulderCenterY + 0.82 * torsoLength };
  landmarks[14] = midpoint(landmarks[12], landmarks[16]);
  landmarks[27] = { ...landmarks[27], x: hipCenterX + 0.34 * torsoLength };
  landmarks[28] = { ...landmarks[28], x: hipCenterX - 0.27 * torsoLength };
  return sample;
}

function midpoint(first: Landmark, second: Landmark): Landmark {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    z: 0,
    visibility: 0.99,
    presence: 0.99,
  };
}

function duoSample(
  playerOne: PoseSample,
  playerTwo?: PoseSample,
  reversed = false,
  primaryLandmarks?: Landmark[],
): PoseSample {
  const ordered = playerTwo
    ? reversed ? [playerTwo.landmarks, playerOne.landmarks] : [playerOne.landmarks, playerTwo.landmarks]
    : [playerOne.landmarks];
  return {
    timestampMs: 0,
    frameWidth: 640,
    frameHeight: 480,
    landmarks: primaryLandmarks ?? ordered[0],
    players: ordered,
  };
}

async function readScore(page: Page): Promise<number> {
  return Number((await page.locator('#score').textContent())?.trim() ?? 0);
}

async function scoreAuthoredDanceCues(
  page: Page,
  mode: 'dance-party' | 'dance-duo',
  characterId: string,
  testInfo: TestInfo,
  firstCueIndex: number,
): Promise<void> {
  const guide = page.locator('#dance-guide');
  const target = page.locator('#dance-target');
  const progress = page.locator('#dance-progress');
  let lastAcceptedScore = await readScore(page);
  for (let cueIndex = firstCueIndex; cueIndex < DANCE_CUES.length; cueIndex += 1) {
    await expect(guide).toHaveAttribute('data-cue-index', String(cueIndex), { timeout: 10_000 });
    await expect(guide).toHaveAttribute('data-cue-id', DANCE_CUES[cueIndex].id);
    await expect(target).toHaveText(DANCE_CUES[cueIndex].name);
    await expect(page.locator('#game-world')).toHaveAttribute('data-dance-visible', 'true');
    await expect(page.locator('#game-world')).toHaveAttribute('data-dance-cue-index', String(cueIndex));
    await expect(page.locator('#game-world')).toHaveAttribute('data-mirror-coach-character', characterId);
    const completedBefore = Number(await progress.getAttribute('aria-valuenow') ?? '0');
    const alreadyCompleted = completedBefore >= cueIndex + 1;
    const sample = mode === 'dance-duo'
      ? danceDuoSample(cueIndex, { reversed: cueIndex % 2 === 0 })
      : dancePose(cueIndex);
    await setModePose(page, mode, sample);
    if (!alreadyCompleted) {
      await expect.poll(async () => {
        const completed = Number(await progress.getAttribute('aria-valuenow') ?? '0');
        const score = await readScore(page);
        return completed >= cueIndex + 1 && score > lastAcceptedScore;
      }, { timeout: 2500, intervals: [50, 100, 150] }).toBe(true);
    }
    const completedAfter = Number(await progress.getAttribute('aria-valuenow') ?? '0');
    const scoreAfter = await readScore(page);
    expect(completedAfter, `${mode} should have resolved cue ${cueIndex + 1}`).toBeGreaterThanOrEqual(cueIndex + 1);
    if (!alreadyCompleted) expect(scoreAfter).toBeGreaterThan(lastAcceptedScore);
    if (scoreAfter > lastAcceptedScore) lastAcceptedScore = scoreAfter;
    await expect(target).toHaveText(DANCE_CUES[cueIndex].name);
    await page.waitForTimeout(200);
    const cueNumber = String(cueIndex + 1).padStart(2, '0');
    await page.screenshot({
      path: testInfo.outputPath(`dance-${mode}-${characterId}-cue-${cueNumber}-${DANCE_CUES[cueIndex].id}.png`),
    });
    if (cueIndex === 5) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('#game-world')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`dance-${mode}-${characterId}-mobile-cue-${cueNumber}-${DANCE_CUES[cueIndex].id}.png`),
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  }
}

function scoreText(score: number): string {
  return String(score).padStart(3, '0');
}
