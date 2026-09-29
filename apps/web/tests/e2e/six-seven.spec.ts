import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

test('teaches the alternating-hand sequence and scores one complete 6-7-6 cycle', async ({ page }) => {
  test.setTimeout(35_000);
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

  await page.goto('.');
  await page.getByRole('button', { name: /Six-Seven Challenge/ }).click();
  await expect(page.locator('#move-left .move-copy')).toContainText('Raise left hand');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByRole('heading', { name: 'Raise your left hand.' })).toBeVisible({ timeout: 7000 });

  await setPose(page, 'left');
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setPose(page);
  await expect(page.getByRole('heading', { name: 'Now raise your right hand.' })).toBeVisible();
  await setPose(page, 'right');
  await expect(page.locator('.stage-ready')).toBeVisible();

  await setPose(page, 'up');
  await expect(page.getByRole('heading', { name: 'Great. Hands down.' })).toBeVisible();
  await setPose(page);
  await expect(page.locator('.stage-countdown')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });

  await setPose(page, 'left');
  await page.waitForTimeout(300);
  await setPose(page, 'right');
  await page.waitForTimeout(300);
  await setPose(page, 'left');
  await expect.poll(async () => Number(await page.locator('#score').textContent()), { timeout: 2500, intervals: [50] }).toBe(100);
  await expect(page.locator('#mode-cue-score')).toContainText('1 CYCLES');
});

async function setPose(page: import('@playwright/test').Page, arms: Parameters<typeof pose>[2] = 'down') {
  const sample = pose(0, 0, arms);
  if (arms === 'left') sample.landmarks[16].y = .65;
  if (arms === 'right') sample.landmarks[15].y = .65;
  await page.evaluate(value => {
    (window as unknown as { poseFixture: { sample: typeof value } }).poseFixture.sample = value;
  }, sample);
}
