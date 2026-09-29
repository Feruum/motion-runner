import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

test('collects visible low and high stars, misses without contact, recovers and replays', async ({ page }, testInfo) => {
  test.setTimeout(105_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/leaderboard**', route => route.fulfill({ json:{mode:'classic-run',entries:[],personalBest:null} }));
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

  const canvas=page.locator('#game-world');
  await expect(page.locator('#rhythm-guide')).toContainText('Low star: lean');
  await expect(page.locator('#mode-cue-title')).toHaveText('Lean left · collect the low star');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-rhythm-visible-stars'))).toBeGreaterThan(0);
  await page.screenshot({path:testInfo.outputPath('stars-approaching.png')});
  // Enter the lane early and hold it: visible contact, not a timed gesture edge, earns the pickup.
  await setPose(-.35);
  await expect(page.locator('#mode-cue-title')).toHaveText('Stay left · the star is coming to you');
  await expect(canvas).toHaveAttribute('data-rhythm-collected','1');
  await expect.poll(async()=>Number(await page.locator('#score').textContent())).toBeGreaterThan(0);
  const lowScore=Number(await page.locator('#score').textContent());
  expect(lowScore).toBeGreaterThan(0);
  await page.screenshot({path:testInfo.outputPath('low-star-collected.png')});
  await setPose();
  await expect(canvas).toHaveAttribute('data-rhythm-next-height','high');
  await expect(page.locator('#mode-cue-title')).toHaveText('Raise both hands · jump for the star');
  await setPose(0,'up');
  await page.screenshot({path:testInfo.outputPath('high-star-jump.png')});
  await expect(canvas).toHaveAttribute('data-rhythm-collected','2');
  await expect.poll(async()=>Number(await page.locator('#score').textContent())).toBeGreaterThan(lowScore);
  await setPose();
  // Stay in the center while the right-lane star passes. It must not award points.
  const score = await page.locator('#score').textContent();
  await expect(canvas).toHaveAttribute('data-rhythm-next-id','3');
  await expect(page.locator('#score')).toHaveText(score!);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#rhythm-guide')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('stars-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});

  const missingPose = pose(0);
  for (const landmark of missingPose.landmarks) landmark.visibility = 0;
  await setPoseFromSample(page, missingPose);
  await expect(page.locator('.stage-paused')).toBeVisible();
  const frozenZ=await canvas.getAttribute('data-rhythm-next-z');
  await page.waitForTimeout(550);
  await expect(canvas).toHaveAttribute('data-rhythm-next-z',frozenZ!);
  await setPose();
  await expect(page.locator('.stage-countdown')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#score')).toHaveText(score!);
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
  expect(await page.locator('#score').textContent()).toBe(score);
  await expect(page.locator('.stage-results')).toBeVisible({timeout:65_000});
  await expect(page.locator('.stage-results')).toContainText('You collected 2 stars');
  await page.screenshot({path:testInfo.outputPath('star-results.png')});
  await page.getByRole('button',{name:'Run again',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-stage','COUNTDOWN');
  await expect(page.locator('#score')).toHaveText('000');
  await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');
  await expect(canvas).toHaveAttribute('data-rhythm-collected','0');
  await expect(canvas).toHaveAttribute('data-rhythm-next-id','0');
  expect(errors).toEqual([]);
});

async function setPoseFromSample(page: import('@playwright/test').Page, sample: ReturnType<typeof pose>) {
  await page.evaluate(value => {
    (window as unknown as { poseFixture: { sample: typeof value } }).poseFixture.sample = value;
  }, sample);
}
