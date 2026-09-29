import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

test('Dodge Arena warns, scores a safe lane, and renders results in local dev mode', async ({ page }, testInfo) => {
  test.setTimeout(55_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
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
  }, pose(0));

  await page.goto('/?dev=1');
  const devBadge = await page.locator('#dev-badge').textContent();
  if (!devBadge?.includes('DEV RUN')) {
    test.skip(true, 'The short Dodge Arena results flow uses the Vite development duration.');
  }
  await page.locator('[data-mode="dodge-arena"]').click();
  await page.getByRole('button', { name: 'Enable camera' }).click();

  await expect(page.getByRole('heading', { name: 'Lean into the left lane.' })).toBeVisible({ timeout: 7000 });
  await setPose(page, -.35);
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setPose(page);
  await expect(page.getByRole('heading', { name: 'Now find the right lane.' })).toBeVisible();
  await setPose(page, .35);
  await expect(page.locator('.stage-ready')).toBeVisible();

  await setPose(page, 0, 'up');
  await expect(page.getByRole('heading', { name: 'Great. Hands down.' })).toBeVisible();
  await setPose(page);
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'COUNTDOWN');
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });

  await expect(page.locator('#mode-cue-title')).toContainText('Move out of the center lane', { timeout: 5000 });
  await page.screenshot({ path: testInfo.outputPath('dodge-warning.png') });
  await setPose(page, .35);
  await expect(page.locator('#score')).toHaveText('010', { timeout: 4000 });
  await expect(page.locator('#mode-cue-score')).toContainText('1 WAVES');

  const scoreBeforePause = await page.locator('#score').textContent();
  await setSample(page, { ...pose(0), landmarks: [] });
  await expect(page.locator('.stage-paused')).toBeVisible({ timeout: 3000 });
  await setPose(page, 0, 'up');
  await page.waitForTimeout(1100);
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PAUSED');
  await setPose(page);
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'COUNTDOWN', { timeout: 3000 });
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 2500 });
  await expect(page.locator('#score')).toHaveText(scoreBeforePause!);

  await expect(page.locator('.stage-results')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.results-metrics')).toContainText('WAVES CLEARED');
  await page.screenshot({ path: testInfo.outputPath('dodge-results.png') });

  await setPose(page, 0, 'up');
  await expect(page.locator('.replay-instruction')).toContainText('Gesture accepted', { timeout: 2500 });
  await setPose(page);
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'COUNTDOWN');
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
  await expect(page.locator('#score')).toHaveText('000');
  expect(errors).toEqual([]);
});

async function setPose(page: import('@playwright/test').Page, lean = 0, arms: Parameters<typeof pose>[2] = 'down') {
  const sample = pose(0, lean, arms);
  await setSample(page, sample);
}

async function setSample(page: import('@playwright/test').Page, sample: ReturnType<typeof pose>) {
  await page.evaluate(value => {
    (window as unknown as { poseFixture: { sample: typeof value } }).poseFixture.sample = value;
  }, sample);
}
