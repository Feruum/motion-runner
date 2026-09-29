import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PoseTracker } from '../src/vision/pose-tracker';
import { pose } from './fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('camera processing failures after startup', () => {
  let now: number;
  let frame: FrameRequestCallback;
  let workers: FakeWorker[];
  let stopTrack: ReturnType<typeof vi.fn>;
  let video: HTMLVideoElement;
  let stream: { getTracks: () => { stop: ReturnType<typeof vi.fn> }[] };
  let nextActualDelegate: 'GPU' | 'CPU' | undefined;
  let failCpuInitialization: boolean;
  let deferFirstWorkerReady: boolean;
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
    terminate = vi.fn();
    requestedDelegate: 'GPU' | 'CPU' | undefined;
    actualDelegate: 'GPU' | 'CPU' | undefined = nextActualDelegate;
    postMessage = vi.fn((message: { type: string; delegate?: 'GPU' | 'CPU' }) => {
      if (message.type === 'init') {
        this.requestedDelegate = message.delegate;
        if (message.delegate === 'CPU' && failCpuInitialization) {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'error', message: 'CPU model failed to initialize' } }));
          return;
        }
        if (deferFirstWorkerReady && workers[0] === this) return;
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', delegate: this.actualDelegate ?? message.delegate ?? 'GPU' } }));
      }
    });
    constructor() { workers.push(this); }
    ready() { this.onmessage?.({ data: { type: 'ready', delegate: this.actualDelegate ?? this.requestedDelegate ?? 'GPU' } }); }
    reply(timestampMs = now, landmarks = pose(now).landmarks) {
      this.onmessage?.({ data: { type: 'pose', sample: { ...pose(timestampMs), landmarks } } });
    }
  }
  beforeEach(() => {
    now = 0; workers = []; stopTrack = vi.fn(); nextActualDelegate = undefined; failCpuInitialization = false; deferFirstWorkerReady = false;
    stream = { getTracks: () => [{ stop: stopTrack }] };
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    video = { readyState: 4, srcObject: null, play: vi.fn(async () => {}) } as unknown as HTMLVideoElement;
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const step = async (time: number) => { now = time; frame(time); await Promise.resolve(); };

  it('stops a camera stream that resolves after startup is cancelled', async () => {
    const camera = deferred<MediaStream>();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(camera.promise);
    const error = vi.fn();
    const tracker = new PoseTracker(video, vi.fn(), error);
    const starting = tracker.start();
    await Promise.resolve();

    tracker.stop();
    camera.resolve(stream as unknown as MediaStream);

    await expect(starting).rejects.toMatchObject({ name: 'AbortError' });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('settles a cancelled worker startup and keeps the next camera session active', async () => {
    deferFirstWorkerReady = true;
    const firstCamera = deferred<MediaStream>();
    const firstStopTrack = vi.fn();
    const firstStream = { getTracks: () => [{ stop: firstStopTrack }] } as unknown as MediaStream;
    const secondStopTrack = vi.fn();
    const secondStream = { getTracks: () => [{ stop: secondStopTrack }] } as unknown as MediaStream;
    vi.mocked(navigator.mediaDevices.getUserMedia)
      .mockReset()
      .mockReturnValueOnce(firstCamera.promise)
      .mockResolvedValueOnce(secondStream);
    const received = vi.fn();
    const tracker = new PoseTracker(video, received, vi.fn());

    const oldStart = tracker.start();
    const oldWorker = workers[0];
    const newStart = tracker.start();
    workers.at(-1)!.ready();
    await newStart;

    firstCamera.resolve(firstStream);
    await Promise.resolve();
    await Promise.resolve();
    oldWorker.ready();
    oldWorker.reply();

    const oldResult = await Promise.race([
      oldStart.then(() => 'resolved', error => error),
      new Promise(resolve => setTimeout(() => resolve('pending'), 50)),
    ]);
    expect(oldResult).toMatchObject({ name: 'AbortError' });
    expect(firstStopTrack).toHaveBeenCalledOnce();
    expect(video.srcObject).toBe(secondStream);
    expect(secondStopTrack).not.toHaveBeenCalled();
    expect(received).not.toHaveBeenCalled();

    tracker.stop();
    expect(secondStopTrack).toHaveBeenCalledOnce();
  });

  it('restarts a crashed GPU worker once on CPU and keeps the camera live', async () => {
    const error = vi.fn();
    const tracker = new PoseTracker(video, vi.fn(), error);
    await tracker.start();
    workers[0].onerror?.({ message: 'GPU context lost', preventDefault: vi.fn() });
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
    expect(workers).toHaveLength(2);
    expect(workers[1].requestedDelegate).toBe('CPU');
    expect(video.srcObject).toBe(stream);
    expect(stopTrack).not.toHaveBeenCalled();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    workers[1].reply();
    expect(error).not.toHaveBeenCalled();
    tracker.stop();
  });

  it.each(['silent worker', 'unavailable video', 'persistently stale poses'] as const)('falls back once, bounds CPU waiting and allows retry for %s', async failure => {
    const error = vi.fn();
    const received = vi.fn();
    const tracker = new PoseTracker(video, received, error);
    await tracker.start();
    if (failure === 'unavailable video') {
      workers[0].reply();
      Object.defineProperty(video, 'readyState', { value: 0, configurable: true });
    }
    for (let time = 1000; time <= 8000; time += 1000) {
      now = time;
      if (failure === 'persistently stale poses') workers.at(-1)!.reply(time - 500);
      await step(time);
    }
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].requestedDelegate).toBe('CPU');
    expect(video.srcObject).toBe(stream);
    expect(stopTrack).not.toHaveBeenCalled();
    for (let time = 9000; time <= 16000; time += 1000) {
      now = time;
      if (failure === 'persistently stale poses') workers.at(-1)!.reply(time - 500);
      await step(time);
    }
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toMatch(/try again/i);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
    const oldWorker = workers[0];
    const cpuWorker = workers[1];
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    await tracker.start();
    received.mockClear();
    oldWorker.reply();
    cpuWorker.reply();
    expect(received).not.toHaveBeenCalled();
    workers[2].reply();
    expect(received).toHaveBeenCalledOnce();
    tracker.stop();
  });

  it('does not restart a worker that already initialized on CPU', async () => {
    const error = vi.fn();
    nextActualDelegate = 'CPU';
    const tracker = new PoseTracker(video, vi.fn(), error);
    await tracker.start();
    // The first worker may have used CPU as its initialization fallback.
    expect(workers[0].requestedDelegate).toBe('GPU');
    for (let time = 1000; time <= 8000; time += 1000) await step(time);
    expect(error).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(1);
    tracker.stop();
  });

  it('stops after a failed CPU recovery instead of retrying forever', async () => {
    const error = vi.fn();
    const tracker = new PoseTracker(video, vi.fn(), error);
    await tracker.start();
    failCpuInitialization = true;
    for (let time = 1000; time <= 8000; time += 1000) await step(time);
    await Promise.resolve();
    expect(workers).toHaveLength(2);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toMatch(/CPU recovery failed/i);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('keeps running when fresh frames contain no person and does not expire while hidden', async () => {
    const error = vi.fn();
    const tracker = new PoseTracker(video, vi.fn(), error);
    await tracker.start();
    for (let time = 1000; time <= 12_000; time += 1000) {
      now = time; workers[0].reply(time, []); await step(time);
    }
    Object.assign(document, { hidden: true });
    await step(60_000);
    Object.assign(document, { hidden: false });
    now = 120_000;
    document.dispatchEvent(new Event('visibilitychange'));
    await step(120_050);
    expect(error).not.toHaveBeenCalled();
    tracker.stop();
  });
});
