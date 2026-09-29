import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

test('plays a rhythm cue and resumes with the score intact after tracking loss', async ({ page }) => {
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
  await page.getByRole('button', { name: /Rhythm Run/ }).click();
  await page.getByRole('button', { name: 'Enable camera' }).click();

  const setPose = (lean = 0, arms: Parameters<typeof pose>[2] = 'down') => page.evaluate(sample => {
    (window as unknown as { poseFixture: { sample: typeof sample } }).poseFixture.sample = sample;
  }, pose(0, lean, arms));

  await expect(page.getByRole('heading', { name: 'Lean into the left lane.' })).toBeVisible({ timeout: 5000 });
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
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });

  await page.waitForFunction(() => document.querySelector('#mode-cue-title')?.textContent?.includes('MOVE NOW · Lean left'), undefined, { timeout: 4500 });
  await setPose(-.35);
  await expect.poll(async () => Number(await page.locator('#score').textContent()), { timeout: 2500, intervals: [50] }).toBeGreaterThan(0);
  const score = await page.locator('#score').textContent();

  const missingPose = pose(0);
  for (const landmark of missingPose.landmarks) landmark.visibility = 0;
  await setPoseFromSample(page, missingPose);
  await expect(page.locator('.stage-paused')).toBeVisible();
  await setPose();
  await expect(page.locator('.stage-countdown')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#score')).toHaveText(score!);
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
  expect(await page.locator('#score').textContent()).toBe(score);
});

async function setPoseFromSample(page: import('@playwright/test').Page, sample: ReturnType<typeof pose>) {
  await page.evaluate(value => {
    (window as unknown as { poseFixture: { sample: typeof value } }).poseFixture.sample = value;
  }, sample);
}
