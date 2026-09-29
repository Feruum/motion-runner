import { expect, test, type Page } from '@playwright/test';
import type { Landmark, PoseSample } from '@motion-runner/game';
import { pose } from '../fixtures';

type MirrorAction = 'LEFT' | 'RIGHT' | 'LEFT_HAND_UP' | 'RIGHT_HAND_UP' | 'BOTH_HANDS_UP' | 'ARMS_OUT';

test('Mirror coach demos, scores, pauses safely, and replays the real 60-second challenge', async ({ page }, testInfo) => {
  test.setTimeout(140_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/leaderboard**', route => route.fulfill({
    json: { mode: 'classic-run', entries: [], personalBest: null },
  }));
  await installMirrorPoseFixture(page);

  await page.goto('/');
  await expect(page.locator('[data-mode="mirror-challenge"]')).toBeVisible();
  await page.locator('[data-mode="mirror-challenge"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-selected-mode', 'mirror-challenge');
  await expect(page.locator('#timer')).toHaveText('01:00');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await completeMirrorTutorial(page);

  const canvas = page.locator('#game-world');
  const dialogue = page.locator('#mirror-dialogue');
  const voiceToggle = page.getByRole('button', { name: 'Coach voice' });
  await expect(dialogue).toBeVisible();
  await expect(canvas).toHaveAttribute('data-mirror-coach-visible', 'true');
  await expect(canvas).toHaveAttribute('data-mirror-coach-action', 'LEFT');
  await expect(canvas).toHaveAttribute('data-mirror-coach-phase', 'demo');
  await expect(page.locator('#mirror-command')).toContainText(/lean left/i);
  await expect(page.locator('#mirror-phase')).toContainText(/watch me/i);
  await page.screenshot({ path: testInfo.outputPath('mirror-coach-first-demo-desktop.png') });

  const speechBefore = await readSpeechLog(page);
  await expect.poll(() => readSpeechLog(page).then(log => log.spoken.length), { timeout: 4000 }).toBeGreaterThan(0);
  const firstDemoSpeechCount = (await readSpeechLog(page)).spoken.length;
  await page.waitForTimeout(250);
  expect((await readSpeechLog(page)).spoken.length).toBe(firstDemoSpeechCount);

  await expect(voiceToggle).toHaveAttribute('aria-pressed', 'true');
  await voiceToggle.click();
  await expect(voiceToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(voiceToggle).toHaveText('Voice off');
  expect((await readSpeechLog(page)).canceled).toBeGreaterThan(speechBefore.canceled);
  const mutedSpeechCount = (await readSpeechLog(page)).spoken.length;

  await startMirrorPoseDriver(page);
  await expect(canvas).toHaveAttribute('data-mirror-coach-phase', 'attempt', { timeout: 5000 });
  await expect(page.locator('#mirror-hold')).not.toHaveAttribute('aria-valuenow', '0', { timeout: 3000 });
  await expect(page.locator('#mirror-phase')).toContainText(/your turn|hold the pose/i);
  await page.screenshot({ path: testInfo.outputPath('mirror-coach-desktop-midpose.png') });

  // Drop tracking briefly. The live assignment and challenge clock must stay put.
  await page.evaluate(() => { (window as any).__mirrorDriver.enabled = false; });
  await setSample(page, { ...pose(0), landmarks: [] });
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PAUSED', { timeout: 5000 });
  await expect(dialogue).toBeHidden();
  const pausedTimer = await page.locator('#timer').textContent();
  const pausedAction = await canvas.getAttribute('data-mirror-coach-action');
  const pausedPhase = await canvas.getAttribute('data-mirror-coach-phase');
  await page.waitForTimeout(1200);
  await expect(page.locator('#timer')).toHaveText(pausedTimer!);
  await expect(canvas).toHaveAttribute('data-mirror-coach-action', pausedAction!);
  await expect(canvas).toHaveAttribute('data-mirror-coach-phase', pausedPhase!);

  await setSample(page, pose(0));
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 7000 });
  await page.evaluate(() => { (window as any).__mirrorDriver.enabled = true; });
  await expect(dialogue).toBeVisible();
  await expect(canvas).toHaveAttribute('data-mirror-coach-action', 'LEFT');
  await expect.poll(async () => readScore(page), { timeout: 5000, intervals: [100, 150, 250] }).toBeGreaterThan(0);

  // Keep voice disabled through the right-lean demo, then re-enable it and
  // check that a later cue is spoken once instead of on every render frame.
  await expect(canvas).toHaveAttribute('data-mirror-coach-action', 'RIGHT', { timeout: 9000 });
  await expect(canvas).toHaveAttribute('data-mirror-coach-phase', 'demo');
  expect((await readSpeechLog(page)).spoken.length).toBe(mutedSpeechCount);
  await voiceToggle.click();
  await expect(voiceToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(voiceToggle).toHaveText('Voice on');
  await expect.poll(() => readSpeechLog(page).then(log => log.spoken.length), { timeout: 3000 }).toBeGreaterThan(mutedSpeechCount);
  const rightCueSpeechCount = (await readSpeechLog(page)).spoken.length;
  await page.waitForTimeout(250);
  expect((await readSpeechLog(page)).spoken.length).toBe(rightCueSpeechCount);

  await expect(canvas).toHaveAttribute('data-mirror-coach-action', 'ARMS_OUT', { timeout: 40_000 });
  await expect(canvas).toHaveAttribute('data-mirror-coach-phase', 'demo');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialogue).toBeVisible();
  await expect(canvas).toHaveAttribute('data-mirror-coach-visible', 'true');
  await page.screenshot({ path: testInfo.outputPath('mirror-coach-arms-out-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await expect(page.locator('.stage-results')).toBeVisible({ timeout: 70_000 });
  await expect(page.locator('#timer')).toHaveText('00:00');
  await expect(page.locator('.results-metrics')).toContainText(/SCORE/i);
  expect(await readScore(page)).toBe(800);
  const observed = await page.evaluate(() => (window as any).__mirrorDriver?.observed as string[] ?? []);
  for (const action of ['LEFT', 'RIGHT', 'LEFT_HAND_UP', 'RIGHT_HAND_UP', 'BOTH_HANDS_UP', 'ARMS_OUT']) {
    expect(observed.some(entry => entry.startsWith(`${action}:`)), `coach should demo ${action}`).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('mirror-coach-results-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mirror-coach-results-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Replay uses the usual raised-hands hold. A fresh challenge returns to LEFT.
  await setSample(page, pose(0, 0, 'up'));
  await expect(page.getByRole('progressbar', { name: 'Hold both hands to start' })).toHaveAttribute('aria-valuenow', '100', { timeout: 4000 });
  await setSample(page, pose(0));
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'COUNTDOWN', { timeout: 4000 });
  await expect(page.locator('#score')).toHaveText('000');
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
  await expect(canvas).toHaveAttribute('data-mirror-coach-visible', 'true');
  await expect(canvas).toHaveAttribute('data-mirror-coach-action', 'LEFT');
  await expect(canvas).toHaveAttribute('data-mirror-coach-phase', 'demo');
  await expect(page.locator('#score')).toHaveText('000');
  expect(pageErrors).toEqual([]);
});

async function installMirrorPoseFixture(page: Page): Promise<void> {
  await page.addInitScript(initial => {
    const fixture: { sample: PoseSample } = { sample: initial };
    const speechLog = { spoken: [] as string[], canceled: 0 };
    Object.assign(window, { poseFixture: fixture, __mirrorSpeechLog: speechLog });
    class StubUtterance {
      text: string;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      rate = 1;
      pitch = 1;
      constructor(text: string) { this.text = text; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: StubUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speaking: false,
      pending: false,
      getVoices: () => [],
      speak: (utterance: StubUtterance) => speechLog.spoken.push(utterance.text),
      cancel: () => { speechLog.canceled += 1; },
    } });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const camera = document.createElement('canvas');
      camera.width = 640;
      camera.height = 480;
      camera.getContext('2d')!.fillRect(0, 0, 640, 480);
      return camera.captureStream(24);
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
  }, pose(0));
}

async function completeMirrorTutorial(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Lean into the left lane.' })).toBeVisible({ timeout: 12_000 });
  await setSample(page, pose(0, -0.35));
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setSample(page, pose(0));
  await expect(page.getByRole('heading', { name: 'Now find the right lane.' })).toBeVisible();
  await setSample(page, pose(0, 0.35));
  await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
  await setSample(page, pose(0));
  await expect(page.getByRole('heading', { name: 'Lift off with both hands.' })).toBeVisible();
  await setSample(page, pose(0, 0, 'up'));
  await expect(page.locator('.stage-ready')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Great. Hands down.' })).toBeVisible({ timeout: 3000 });
  await setSample(page, pose(0));
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'COUNTDOWN');
  await expect(page.locator('body')).toHaveAttribute('data-stage', 'PLAYING', { timeout: 5000 });
}

async function setSample(page: Page, sample: PoseSample): Promise<void> {
  await page.evaluate((next: PoseSample) => {
    (window as unknown as { poseFixture: { sample: PoseSample } }).poseFixture.sample = next;
  }, sample);
}

async function startMirrorPoseDriver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fixture = (window as any).poseFixture as { sample: PoseSample };
    const observed: string[] = [];
    let lastState = '';
    const driver = { enabled: true, timer: 0 as number | undefined, observed };
    const point = (x: number, y: number): Landmark => ({ x, y, z: 0, visibility: 0.99, presence: 0.99 });
    const midpoint = (a: Landmark, b: Landmark) => point((a.x + b.x) / 2, (a.y + b.y) / 2);
    const sampleFor = (action: MirrorAction | 'NEUTRAL'): PoseSample => {
      const landmarks: Landmark[] = Array.from({ length: 33 }, () => point(0.5, 0.5));
      const set = (index: number, x: number, y: number) => { landmarks[index] = point(x, y); };
      set(0, 0.5, 0.23); set(2, 0.52, 0.21); set(5, 0.48, 0.21);
      const lean = action === 'LEFT' ? -0.42 : action === 'RIGHT' ? 0.42 : 0;
      const dx = -lean * 0.24;
      set(0, 0.5 + dx, 0.23); set(2, 0.52 + dx, 0.21); set(5, 0.48 + dx, 0.21);
      set(11, 0.62 + dx, 0.4); set(12, 0.38 + dx, 0.4);
      set(23, 0.59, 0.76); set(24, 0.41, 0.76);
      const setArm = (side: 'left' | 'right', pose: 'down' | 'up' | 'out') => {
        const shoulderIndex = side === 'left' ? 11 : 12;
        const elbowIndex = side === 'left' ? 13 : 14;
        const wristIndex = side === 'left' ? 15 : 16;
        const shoulder = landmarks[shoulderIndex];
        const torsoLength = Math.hypot(0.5 - ((landmarks[23].x + landmarks[24].x) / 2), 0.4 - 0.76);
        const outward = side === 'left' ? 1 : -1;
        const wrist = pose === 'up'
          ? point(shoulder.x + outward * 0.62 * torsoLength, shoulder.y - 0.78 * torsoLength)
          : pose === 'out'
            ? point(shoulder.x + outward * 0.8 * torsoLength, shoulder.y)
            : point(shoulder.x, shoulder.y + 1.15 * torsoLength);
        landmarks[wristIndex] = wrist;
        landmarks[elbowIndex] = midpoint(shoulder, wrist);
      };
      const leftUp = action === 'LEFT_HAND_UP' || action === 'BOTH_HANDS_UP';
      const rightUp = action === 'RIGHT_HAND_UP' || action === 'BOTH_HANDS_UP';
      const armsOut = action === 'ARMS_OUT';
      setArm('left', armsOut ? 'out' : leftUp ? 'up' : 'down');
      setArm('right', armsOut ? 'out' : rightUp ? 'up' : 'down');
      return { timestampMs: 0, frameWidth: 640, frameHeight: 480, landmarks };
    };
    const timer = window.setInterval(() => {
      if (!driver.enabled) return;
      const stage = document.body.dataset.stage;
      const canvas = document.querySelector<HTMLCanvasElement>('#game-world');
      if (stage !== 'PLAYING' || !canvas || canvas.dataset.mirrorCoachVisible !== 'true') return;
      const action = (canvas.dataset.mirrorCoachAction || 'LEFT') as MirrorAction;
      const phase = canvas.dataset.mirrorCoachPhase || 'demo';
      const cue = document.querySelector('#mirror-phase')?.textContent ?? '';
      const key = `${action}:${phase}`;
      if (key !== lastState) { observed.push(key); lastState = key; }
      fixture.sample = phase === 'attempt' && !/reset together/i.test(cue) ? sampleFor(action) : sampleFor('NEUTRAL');
    }, 70);
    driver.timer = timer;
    (window as any).__mirrorDriver = driver;
  });
}

async function readScore(page: Page): Promise<number> {
  return Number((await page.locator('#score').textContent())?.trim() ?? 0);
}

async function readSpeechLog(page: Page): Promise<{ spoken: string[]; canceled: number }> {
  return page.evaluate(() => ({ ...(window as any).__mirrorSpeechLog }));
}
