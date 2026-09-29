import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

for (const start of ['gesture', 'button'] as const) {
for (const firstHand of ['left', 'right'] as const) {
test(`Six Seven: ${start} start, ${firstHand}-first pairs count reps and camera retry`, async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.addInitScript(initial => {
    // Old Six Seven scores were points (often 100+) and must not appear as reps.
    localStorage.setItem('motion-runner-best:v2:six-seven', '100');
    const fixture = { sample: initial, failure: '' };
    Object.assign(window, { poseFixture: fixture });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
      return canvas.captureStream(24);
    } });
    class PoseWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
      postMessage(message: { type: string; timestampMs: number; bitmap?: ImageBitmap; delegate?: 'GPU' | 'CPU' }) {
        if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', delegate: message.delegate } }));
        if (message.type === 'frame') {
          message.bitmap?.close();
          if (fixture.failure === 'silent') return;
          if (fixture.failure === 'crash') {
            queueMicrotask(() => this.onerror?.({ message: 'GPU context lost', preventDefault() {} }));
            return;
          }
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
  await expect(page.locator('.intro-copy p')).toContainText('two movements make one repetition');
  await expect(page.locator('#move-right .move-copy')).toContainText('Two movements = 1 rep');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByRole('heading', { name: 'Lift your left hand higher.' })).toBeVisible({ timeout: 7000 });

  await setPose(page, 'left');
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setPose(page);
  await expect(page.getByRole('heading', { name: 'Now lift your right hand higher.' })).toBeVisible();
  await setPose(page, 'right');
  await expect(page.locator('.stage-ready')).toBeVisible();

  if (start === 'gesture') {
    await setPose(page, 'partial');
    await expect(page.locator('.stage-ready')).toContainText('above your head');
    await setPose(page, 'up');
    await expect(page.getByRole('heading', { name: 'Great. Hands down.' })).toBeVisible();
    await setPose(page);
  } else {
    await setPose(page, 'up');
    await expect(page.getByRole('button', { name: 'Start game' })).toBeDisabled();
    await setPose(page);
    await page.getByRole('button', { name: 'Start game' }).click();
  }
  await expect(page.locator('.stage-countdown')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
  await expect(page.locator('#game-world')).toHaveAttribute('data-six-seven-visible', 'true');
  await expect(page.locator('#six-seven-guide')).toBeVisible();
  await expect(page.locator('#six-seven-guide')).toContainText('Two movements = one rep');

  await setPose(page, firstHand);
  await expect(page.locator('#mode-cue-title')).toContainText('1/2');
  // Holding one hand is correct here; it must remain the first half, not count repeatedly.
  await page.waitForTimeout(800);
  await expect(page.locator('#mode-cue-title')).toBeVisible();
  await expect(page.locator('#correction-toast')).toBeHidden();
  const otherHand = firstHand === 'left' ? 'right' : 'left';
  await setPose(page, otherHand);
  await expect.poll(async () => Number(await page.locator('#score').textContent()), { timeout: 2500, intervals: [50] }).toBe(1);
  await expect(page.locator('#score')).toHaveText('1');
  await expect(page.locator('.score-chip .hud-label')).toHaveText('REPS');
  await expect(page.locator('#mode-cue-score')).toHaveText('1 REP');
  await page.waitForTimeout(800);
  await expect(page.locator('#score')).toHaveText('1');
  await setPose(page, firstHand);
  await expect(page.locator('#mode-cue-title')).toContainText('1/2');
  await expect(page.locator('#score')).toHaveText('1');
  await setPose(page, otherHand);
  await expect.poll(async () => Number(await page.locator('#score').textContent()), { timeout: 2500, intervals: [50] }).toBe(2);
  await expect(page.locator('#mode-cue-score')).toHaveText('2 REPS');
  // Capture evidence after the timed sequence; screenshot encoding must not
  // consume the player's two-second switching window.
  await page.screenshot({ path: testInfo.outputPath('six-seven-repetitions.png') });
  await page.evaluate(failure => {
    (window as unknown as { poseFixture: { failure: string } }).poseFixture.failure = failure;
  }, start === 'gesture' ? 'crash' : 'silent');
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'ERROR', { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Camera tracking stopped.' })).toBeVisible({ timeout: 1500 });
  await expect(page.locator('#camera-status')).toContainText('CAMERA NEEDS ATTENTION');
  await expect(page.locator('.stage-error')).toContainText('Try again');
  await page.screenshot({ path: testInfo.outputPath('camera-retry.png') });
  await page.evaluate(() => {
    (window as unknown as { poseFixture: { failure: string } }).poseFixture.failure = '';
  });
  await setPose(page);
  await page.getByRole('button', { name: /^Try again/ }).click();
  await expect(page.getByRole('heading', { name: 'Lift your left hand higher.' })).toBeVisible();
});
}
}

async function setPose(page: import('@playwright/test').Page, arms: Parameters<typeof pose>[2] = 'down') {
  const sample = pose(0, 0, arms);
  if (arms === 'left' || arms === 'right') {
    // Actual meme: bent elbows, alternating hands below shoulder level.
    sample.landmarks[13].y = sample.landmarks[14].y = .59;
    sample.landmarks[15].y = arms === 'left' ? .48 : .62;
    sample.landmarks[16].y = arms === 'right' ? .48 : .62;
  }
  await page.evaluate(value => {
    (window as unknown as { poseFixture: { sample: typeof value } }).poseFixture.sample = value;
  }, sample);
}
