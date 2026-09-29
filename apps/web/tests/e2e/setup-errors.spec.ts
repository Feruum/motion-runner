import { expect, test } from '@playwright/test';
import { pose } from '../fixtures';

for (const failure of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'model'] as const) {
  test(`recovers camera setup after ${failure}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ failure, sample }) => {
      let cameraAttempts = 0;
      let workers = 0;
      const streams: MediaStream[] = [];
      Object.assign(window, { setupStreams: streams });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
        cameraAttempts++;
        if (cameraAttempts === 1 && failure !== 'model') throw new DOMException('Test camera failure', failure);
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
        const stream = canvas.captureStream(24);
        streams.push(stream);
        return stream;
      } });
      class PoseWorker {
        private attempt = ++workers;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        postMessage(message: { type: string; timestampMs: number; bitmap?: ImageBitmap }) {
          if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data:
            failure === 'model' && this.attempt === 1
              ? { type: 'error', message: 'The pose model could not load.' }
              : { type: 'ready' },
          }));
          if (message.type === 'frame') {
            message.bitmap?.close();
            queueMicrotask(() => this.onmessage?.({ data: { type: 'pose', sample: { ...sample, timestampMs: message.timestampMs } } }));
          }
        }
        terminate() {}
      }
      Object.defineProperty(window, 'Worker', { value: PoseWorker });
    }, { failure, sample: pose(0) });
    await page.goto('/');
    await page.getByRole('button', { name: 'Enable camera' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-stage', 'ERROR');
    const messages = {
      NotAllowedError: 'Camera access was blocked.',
      NotFoundError: 'No camera was found.',
      NotReadableError: 'The camera is busy in another app.',
      model: 'The pose model could not load.',
    };
    await expect(page.locator('.stage-error')).toContainText(messages[failure]);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { setupStreams: MediaStream[] }).setupStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')),
    )).toBe(true);
    await page.getByRole('button', { name: /^Try again/ }).click();
    await expect(page.getByRole('heading', { name: 'Lean into the left lane.' })).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });
}
