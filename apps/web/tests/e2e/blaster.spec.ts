import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

const firstTarget = { x: 0.5 - 0.72 * 0.36, y: 0.58 - 0.36 * 0.36 };

test('Beat Blaster is in the release picker and scores matching-hand entries in a short camera run', async ({ page }) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/leaderboard**', route => route.fulfill({ json: { mode: 'classic-run', entries: [], personalBest: null } }));
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

  await page.goto('/');
  await expect(page.locator('[data-mode="beat-blaster"]')).toBeVisible();
  await page.goto('/?dev=1');
  const devBadge = await page.locator('#dev-badge').textContent();
  if (!devBadge?.includes('DEV RUN')) {
    test.skip(true, 'The short camera flow uses the Vite development server.');
  }

  await expect(page.locator('[data-mode="beat-blaster"]')).toBeVisible();
  await page.locator('[data-mode="beat-blaster"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-selected-mode', 'beat-blaster');
  await expect(page.locator('#timer')).toHaveText('00:20');
  await page.getByRole('button', { name: 'Enable camera' }).click();

  await expect(page.getByRole('heading', { name: 'Reach with your left hand.' })).toBeVisible({ timeout: 7000 });
  await setPose(page, firstReach('wrong'));
  await expect(page.locator('.stage-tutorial')).toContainText('Use your left hand to reach toward the target.');
  await setPose(page, tutorialReach('left'));
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setPose(page, pose(0));
  await expect(page.getByRole('heading', { name: 'Now reach with your right hand.' })).toBeVisible();
  await setPose(page, tutorialReach('right'));
  await expect(page.locator('.stage-ready')).toBeVisible();
  await setPose(page, pose(0, 0, 'up'));
  await expect(page.getByRole('heading', { name: 'Great. Hands down.' })).toBeVisible();
  // Lowering both hands after the one-second hold starts the countdown.
  await setPose(page, pose(0));
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'COUNTDOWN');
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#skeleton-canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let targetPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 80 && pixels[index + 1] > 200 && pixels[index + 2] > 220 && pixels[index + 3] > 0) targetPixels++;
    }
    return targetPixels;
  })).toBeGreaterThan(8);

  await setPose(page, firstReach('wrong'));
  await expect(page.locator('#mode-cue-title')).toContainText('Use your left hand for this target.', { timeout: 3000 });
  await expect(page.locator('#score')).toHaveText('000');

  await setPose(page, pose(0));
  await setPose(page, firstReach('left'));
  await expect(page.locator('#score')).toHaveText(/^(075|100)$/, { timeout: 4000 });
  await expect(page.locator('#mode-cue-title')).toContainText('hit with your left hand.');
  await expect(page.locator('#mode-cue-score')).toContainText('1 / 9 TARGETS');
  expect(errors).toEqual([]);
});

function firstReach(hand: 'left' | 'wrong') {
  const sample = pose(0);
  const targetSourceX = 1 - firstTarget.x;
  if (hand === 'left') {
    sample.landmarks[15].x = targetSourceX;
    sample.landmarks[15].y = firstTarget.y;
    sample.landmarks[16].x = 0.36;
    sample.landmarks[16].y = 0.65;
  } else {
    sample.landmarks[16].x = targetSourceX;
    sample.landmarks[16].y = firstTarget.y;
  }
  return sample;
}

function tutorialReach(hand: 'left' | 'right') {
  const sample = pose(0);
  if (hand === 'left') {
    sample.landmarks[15].x = 0.78;
    sample.landmarks[15].y = 0.45;
  } else {
    sample.landmarks[16].x = 0.22;
    sample.landmarks[16].y = 0.45;
  }
  return sample;
}

async function setPose(page: import('@playwright/test').Page, sample: ReturnType<typeof pose>) {
  await page.evaluate(value => {
    (window as unknown as { poseFixture: { sample: typeof value } }).poseFixture.sample = value;
  }, sample);
}
