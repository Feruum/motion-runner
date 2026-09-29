import { expect, test, type Page } from '@playwright/test';
import type { Landmark, PoseSample } from '@motion-runner/game';
import { pose } from '../fixtures';

const poseModes = ['mirror-challenge', 'dance-party', 'dance-duo'] as const;
type PoseMode = typeof poseModes[number];

test.describe.configure({ mode: 'serial' });

for (const mode of poseModes) {
  test(`${mode} completes the camera flow, scores a pose, and replays`, async ({ page }, testInfo) => {
    test.setTimeout(85_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/leaderboard**', route => route.fulfill({
      json: { mode: 'classic-run', entries: [], personalBest: null },
    }));
    await installPoseFixture(page, mode === 'dance-duo');

    await page.goto('/?dev=1');
    const devBadge = await page.locator('#dev-badge').textContent();
    if (!devBadge?.includes('DEV RUN')) {
      test.skip(true, 'The short pose-mode E2E duration requires the Vite development server.');
    }

    await expect(page.locator(`[data-mode="${mode}"]`)).toBeVisible();
    await page.locator(`[data-mode="${mode}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-selected-mode', mode);
    await expect(page.locator('#timer')).toHaveText('00:20');
    await page.getByRole('button', { name: 'Enable camera' }).click();

    await completeSharedTutorial(page, mode);

    if (mode === 'mirror-challenge') {
      // The first assignment is a short demo followed by a five-second attempt.
      // Holding a clear left lean through both phases must resolve the first task.
      await setModePose(page, mode, pose(0, -0.4));
      await expect.poll(async () => readScore(page), { timeout: 6000, intervals: [100, 150, 250] }).toBeGreaterThan(0);
      await expect(page.locator('#mode-cue-title')).toContainText(/pose|complete|next/i, { timeout: 3000 });
    } else if (mode === 'dance-party') {
      await setModePose(page, mode, reachLeftPose());
      await expect.poll(async () => readScore(page), { timeout: 5000, intervals: [100, 150, 250] }).toBeGreaterThan(0);
      await expect(page.locator('#coach-copy')).toContainText(/phrase complete|hold that pose|cue complete/i, { timeout: 3000 });
    } else {
      const playerOneNeutral = centeredPose(0.34);
      const playerTwoReach = reachLeftPose(0.66);
      // First frame is intentionally in detector order [right, left]. Player 1
      // is the left-hand person and Player 2 is the right-hand person.
      await setModePose(page, mode, duoSample(playerOneNeutral, playerTwoReach, true));
      await expect(page.locator('#camera-status')).toHaveAttribute('data-player-count', '2');
      await expect.poll(async () => readScore(page), { timeout: 5000, intervals: [100, 150, 250] }).toBeGreaterThan(0);
      const playerScores = page.locator('#coach-count');
      await expect(playerScores).toContainText(/P1 0 · P2 [1-9]\d*/);
      const scoreByIdentity = await playerScores.textContent();

      // The detector reverses its output. Feedback must remain assigned to the
      // same visible person, not follow array position.
      await setModePose(page, mode, duoSample(playerOneNeutral, playerTwoReach, false));
      await expect(playerScores).toHaveText(scoreByIdentity!);

      const scoreBeforePause = await readScore(page);
      await setModePose(page, mode, duoSample(playerOneNeutral, undefined));
      await expect(page.locator('#camera-status')).toHaveAttribute('data-player-count', '1', { timeout: 3000 });
      await expect(page.locator('body')).toHaveAttribute('data-stage', 'PAUSED', { timeout: 3000 });
      const timerDuringPause = await page.locator('#timer').textContent();
      await page.waitForTimeout(400);
      await expect(page.locator('#timer')).toHaveText(timerDuringPause!);
      await expect(page.locator('#score')).toHaveText(scoreText(scoreBeforePause));

      // Restore both detections in the opposite order. Recovery must wait for a
      // stable frame, preserve score, and then return to the live round.
      await setModePose(page, mode, duoSample(playerOneNeutral, centeredPose(0.66), true));
      await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 7000 });
      await expect(page.locator('#score')).toHaveText(scoreText(scoreBeforePause));
    }

    const earnedScore = await readScore(page);
    expect(earnedScore).toBeGreaterThan(0);
    await expect(page.locator('.stage-results')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.results-metrics')).toContainText(/SCORE/i);
    await expect(page.locator('#score')).toHaveText(scoreText(earnedScore));
    await page.screenshot({ path: testInfo.outputPath(`${mode}-results.png`) });

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
    Object.assign(window, { poseFixture: fixture });
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

async function completeSharedTutorial(page: Page, mode: PoseMode): Promise<void> {
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
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
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

function scoreText(score: number): string {
  return String(score).padStart(3, '0');
}
