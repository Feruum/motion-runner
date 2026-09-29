import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

test('keeps steering with clipped wrists, preserves score after recovery and offers replay', async ({ page }) => {
  test.setTimeout(140_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/leaderboard**', route => route.fulfill({ json: route.request().method() === 'POST' ? { improved: true } : { mode:'classic-run', entries: [], personalBest:null } }));
  await page.addInitScript(initial => {
    const fixture = { sample: initial };
    Object.assign(window, { poseFixture: fixture });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width=640;canvas.height=480;
      canvas.getContext('2d')!.fillRect(0,0,640,480);
      return canvas.captureStream(24);
    } });
    class PoseWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage(message: { type: string; timestampMs: number; bitmap?: ImageBitmap }) {
        if(message.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));
        if(message.type==='frame'){
          message.bitmap?.close();
          queueMicrotask(()=>this.onmessage?.({data:{type:'pose',sample:{...fixture.sample,timestampMs:message.timestampMs}}}));
        }
      }
      terminate() {}
    }
    Object.defineProperty(window,'Worker',{value:PoseWorker});
  },pose(0));
  const setSample = (sample: ReturnType<typeof pose>) => page.evaluate(value => {
    (window as unknown as {poseFixture:{sample: typeof value}}).poseFixture.sample=value;
  },sample);
  await page.goto('.');
  await page.getByRole('button',{name:'Enable camera'}).click();
  await expect(page.getByRole('heading',{name:'Lean into the left lane.'})).toBeVisible();
  await setSample(pose(0,-.35));
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setSample(pose(0));
  await expect(page.getByRole('heading',{name:'Now find the right lane.'})).toBeVisible();
  await setSample(pose(0,.35));
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setSample(pose(0));
  await expect(page.getByRole('heading',{name:'Lift off with both hands.'})).toBeVisible();
  await setSample(pose(0,0,'up'));
  await expect(page.getByRole('heading',{name:'Great. Hands down.'})).toBeVisible();
  await setSample(pose(0,-.35));
  await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');

  const clipped=pose(0,-.35,'up');clipped.landmarks[15].y=-.02;
  await setSample(clipped);
  await expect(page.locator('#camera-status')).toContainText('HANDS OUT OF VIEW');
  await expect(page.locator('#correction-toast')).toContainText('inside the camera frame');
  await expect(page.locator('#mode-cue')).toBeHidden();
  await page.waitForTimeout(650);
  await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');
  await page.screenshot({path:'test-results/recovery-clipped-wrist.png'});
  await setSample(pose(0,-.35));
  await expect(page.locator('#score')).toHaveText('010',{timeout:10000});

  const missing=pose(0);missing.landmarks[23].visibility=0;
  await setSample(missing);
  await expect(page.locator('.stage-paused')).toContainText('hips');
  await expect(page.locator('#mode-cue')).toBeHidden();
  const score=await page.locator('#score').textContent();
  await setSample(pose(0,0,'up'));
  await expect(page.locator('.stage-paused')).toContainText('Lower both hands below your shoulders',{timeout:2000});
  await setSample(pose(0));
  await expect(page.locator('.stage-countdown')).toContainText('RUN RESUMING');
  await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING',{timeout:3000});
  await expect(page.locator('#score')).toHaveText(score!);
  await setSample(pose(0,0));
  await expect(page.locator('#mode-cue')).toHaveAttribute('data-tone','hit',{timeout:7000});
  await page.screenshot({path:'test-results/recovery-obstacle-feedback.png'});

  await expect(page.locator('.stage-results')).toBeVisible({timeout:70000});
  const replay=page.getByRole('button',{name:'Run again'});
  await expect(replay).toBeEnabled();
  await setSample(pose(0,0,'up'));
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
  await expect(page.locator('.replay-instruction')).toContainText('Gesture accepted');
  await page.screenshot({path:'test-results/recovery-results.png'});
  // Cancel the pending gesture with a lost body, then exercise the button path.
  await setSample(missing);
  await expect(replay).toBeDisabled();
  await setSample(pose(0));
  await expect(replay).toBeEnabled();
  await page.setViewportSize({width:390,height:844});
  await expect(replay).toBeInViewport();
  const hud=await page.locator('.run-hud').boundingBox();
  expect(hud!.y+hud!.height).toBeLessThan(100);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:'test-results/recovery-results-mobile.png'});
  await setSample(pose(0,0,'up'));
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
  await setSample(pose(0));
  await expect(page.locator('body')).toHaveAttribute('data-stage','COUNTDOWN');
  await expect(page.locator('#score')).toHaveText('000');
  await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');
  expect(errors).toEqual([]);
});
