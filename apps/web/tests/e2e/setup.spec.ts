import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }) => {
  // Replace camera/inference only. Exercise the real gesture engine, session and UI.
  await page.addInitScript(initial => {
    const fixture = { sample: initial };
    Object.assign(window, { poseFixture: fixture });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
      return canvas.captureStream(24);
    } });
    class PoseWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage(message: { type: string; timestampMs: number; bitmap?: ImageBitmap }) {
        if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
        if (message.type === 'frame') {
          message.bitmap?.close();
          queueMicrotask(() => this.onmessage?.({ data: {
            type: 'pose', sample: { ...fixture.sample, timestampMs: message.timestampMs },
          } }));
        }
      }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { value: PoseWorker });
  }, pose(0, 0, 'up'));
  await page.goto('.');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.locator('.stage-calibration')).toBeVisible();
});

test('explains calibration and starts through gestures with visible progress', async ({ page }, testInfo) => {
  test.setTimeout(115000);
  const setPose = async (lean = 0, arms: Parameters<typeof pose>[2] = 'down') => {
    await page.evaluate(sample => {
      (window as unknown as { poseFixture: { sample: typeof sample } }).poseFixture.sample = sample;
    }, pose(0, lean, arms));
  };
  await expect(page.locator('.stage-calibration')).toContainText('Lower both hands below your shoulders');
  await setPose();
  await expect.poll(() => page.locator('.calibration-track i').evaluate(el => parseFloat((el as HTMLElement).style.width)), { timeout: 2000, intervals: [50] }).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Lean into the left lane.' })).toBeVisible();
  await setPose(-.35);
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setPose();
  await expect(page.getByRole('heading', { name: 'Now find the right lane.' })).toBeVisible();
  await setPose(.35);
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setPose();
  await expect(page.getByRole('heading', { name: 'Lift off with both hands.' })).toBeVisible();
  await setPose(0, 'up');
  await expect(page.locator('.stage-ready')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Great. Hands down.' })).toBeVisible();
  await setPose();
  await expect(page.locator('.stage-countdown')).toBeVisible();
  await expect(page.locator('.stage-overlay')).toHaveClass(/is-hidden/);
  await setPose(-.35);
  await expect(page.locator('.stage-results')).toBeVisible({ timeout: 75000 });
  const score = Number(await page.locator('.results-metrics strong').first().textContent());
  expect(score).toBeGreaterThan(0);
  expect(await page.evaluate(() => Number(localStorage.getItem('motion-runner-best')))).toBe(score);
  if (testInfo.config.metadata.liveApi) {
    await expect(page.locator('#leaderboard-result-status')).toContainText('Run saved to the leaderboard.');
    const playerId = await page.evaluate(() => localStorage.getItem('motion-runner-player-id'));
    const response = await page.request.get(`/api/leaderboard?playerId=${playerId}`);
    expect(response.ok()).toBe(true);
    expect((await response.json()).personalBest).toMatchObject({ score, isCurrentPlayer: true });
  }
  await setPose(0, 'up');
  // A deliberate held start gesture, measured in real active time.
  await page.waitForTimeout(1600);
  await setPose();
  await expect(page.locator('.stage-countdown')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('000');
  await page.reload();
  expect(await page.evaluate(() => Number(localStorage.getItem('motion-runner-best')))).toBe(score);
});

test('removes a correction promptly when the player returns to neutral', async ({ page }) => {
  const setPose = async (lean: number) => page.evaluate(sample => {
    (window as unknown as { poseFixture: { sample: typeof sample } }).poseFixture.sample = sample;
  }, pose(0, lean));
  await setPose(0);
  await expect(page.getByRole('heading', { name: 'Lean into the left lane.' })).toBeVisible();
  await setPose(-.15);
  await expect(page.locator('#correction-toast')).toContainText('Lean further left');
  await expect(page.locator('#correction-toast')).toHaveClass(/is-visible/);
  await setPose(0);
  await expect(page.locator('#correction-toast')).toBeHidden({ timeout: 700 });
});

test('aligns the skeleton with the video at double pixel density and after resize', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator('#skeleton-canvas').evaluate(el => {
      const canvas = el as HTMLCanvasElement;
      // Nose in a 640x480 video, centered with object-fit: cover.
      const scale = Math.max(canvas.width / 640, canvas.height / 480);
      const x = canvas.width / 2;
      const y = .23 * 480 * scale + (canvas.height - 480 * scale) / 2;
      return canvas.getContext('2d')!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
    })).toBeGreaterThan(200);
  }
});
