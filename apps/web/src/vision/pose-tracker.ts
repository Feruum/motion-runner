import { CONFIG as C } from '@motion-runner/game';
import type { PoseSample } from '@motion-runner/game';

type WorkerMessage =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'pose'; sample: PoseSample }
  | { type: 'error'; message: string };

const trackingTimeoutMs = 8_000;
const cancelledError = (): DOMException => new DOMException('Camera setup was cancelled.', 'AbortError');

export class PoseTracker {
  private worker: Worker | null = null;
  private lifecycle = 0;
  private cancelStartup: ((error: DOMException) => void) | null = null;
  private cancelWorkerInitialization: (() => void) | null = null;
  private workerReady = false;
  private activeDelegate: 'GPU' | 'CPU' | null = null;
  private cpuFallbackAttempted = false;
  private stream: MediaStream | null = null;
  private running = false;
  private inFlight = false;
  private lastSentAt = -Infinity;
  private frameHandle = 0;
  private lastFreshPoseAt = 0;
  private resetWatchdog = (): void => { this.lastFreshPoseAt = performance.now(); };

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onPose: (sample: PoseSample) => void,
    private readonly onError: (message: string) => void,
    private readonly numPoses: 1 | 2 = 1,
  ) {}

  async start(): Promise<void> {
    this.stop();
    const lifecycle = this.lifecycle;
    this.running = true;
    this.cpuFallbackAttempted = false;
    let cancelStartup!: (error: DOMException) => void;
    const startupCancelled = new Promise<never>((_, reject) => { cancelStartup = reject; });
    this.cancelStartup = cancelStartup;
    const workerReady = this.startWorker('GPU');
    const cameraAccess = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
    }).then(stream => {
      if (!this.running || this.lifecycle !== lifecycle) {
        stream.getTracks().forEach(track => track.stop());
        throw cancelledError();
      }
      this.stream = stream;
      return stream;
    });
    try {
      const [stream] = await Promise.race([Promise.all([cameraAccess, workerReady]), startupCancelled]);
      if (!this.running || this.lifecycle !== lifecycle) throw cancelledError();
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      if (!this.running || this.lifecycle !== lifecycle) throw cancelledError();
      this.resetWatchdog();
      document.addEventListener('visibilitychange', this.resetWatchdog);
      this.requestFrame();
    } catch (error) {
      if (this.lifecycle === lifecycle) this.stop();
      throw error;
    } finally {
      if (this.cancelStartup === cancelStartup) this.cancelStartup = null;
    }
  }

  stop(): void {
    this.lifecycle++;
    this.running = false;
    const cancelStartup = this.cancelStartup;
    this.cancelStartup = null;
    cancelStartup?.(cancelledError());
    const cancelWorkerInitialization = this.cancelWorkerInitialization;
    this.cancelWorkerInitialization = null;
    cancelWorkerInitialization?.();
    document.removeEventListener('visibilitychange', this.resetWatchdog);
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    const worker = this.worker;
    this.worker = null;
    this.workerReady = false;
    this.activeDelegate = null;
    worker?.postMessage({ type: 'dispose' });
    worker?.terminate();
    this.inFlight = false;
    this.lastSentAt = -Infinity;
  }

  private startWorker(delegate: 'GPU' | 'CPU'): Promise<void> {
    this.workerReady = false;
    this.inFlight = false;
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      let initialized = false;
      let settled = false;
      const clearCancellation = () => {
        if (this.cancelWorkerInitialization === cancel) this.cancelWorkerInitialization = null;
      };
      const rejectInitialization = (error: Error) => {
        if (settled) return;
        settled = true;
        clearCancellation();
        if (this.worker === worker) this.worker = null;
        worker.terminate();
        reject(error);
      };
      const cancel = () => rejectInitialization(cancelledError());
      this.cancelWorkerInitialization = cancel;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (!this.running || this.worker !== worker) return;
        const message = event.data;
        if (message.type === 'ready') {
          if (settled) return;
          settled = true;
          clearCancellation();
          initialized = true;
          this.workerReady = true;
          this.activeDelegate = message.delegate;
          // The worker may already have fallen back during GPU initialization.
          if (message.delegate === 'CPU') this.cpuFallbackAttempted = true;
          resolve();
          return;
        }
        if (message.type === 'pose') {
          this.inFlight = false;
          if (performance.now() - message.sample.timestampMs <= C.staleMs) this.resetWatchdog();
          this.onPose(message.sample);
          return;
        }
        this.inFlight = false;
        if (!initialized) rejectInitialization(new Error(message.message));
        else this.handleWorkerFailure(worker, message.message);
      };
      worker.onerror = event => {
        if (!this.running || this.worker !== worker) return;
        event.preventDefault();
        this.inFlight = false;
        const error = new Error(event.message || 'The pose model worker stopped unexpectedly.');
        if (!initialized) rejectInitialization(error);
        else this.handleWorkerFailure(worker, error.message);
      };
      worker.postMessage({
        type: 'init',
        delegate,
        wasmUrl: new URL(`${import.meta.env.BASE_URL}wasm/`, window.location.href).href,
        modelUrl: new URL(`${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`, window.location.href).href,
        numPoses: this.numPoses,
      });
    });
  }

  private handleWorkerFailure(worker: Worker, message: string): void {
    if (!this.running || this.worker !== worker) return;
    if (this.activeDelegate === 'GPU' && !this.cpuFallbackAttempted) {
      this.fallbackToCpu(worker);
      return;
    }
    this.fail(message || 'Camera tracking stopped. Try again to reconnect and restart camera setup.');
  }

  private fallbackToCpu(worker: Worker): void {
    if (!this.running || this.worker !== worker || this.cpuFallbackAttempted) return;
    this.cpuFallbackAttempted = true;
    this.worker = null;
    this.workerReady = false;
    this.activeDelegate = null;
    this.inFlight = false;
    this.lastSentAt = -Infinity;
    // Bound the one CPU recovery attempt, including model initialization.
    this.resetWatchdog();
    worker.postMessage({ type: 'dispose' });
    worker.terminate();
    const lifecycle = this.lifecycle;
    void this.startWorker('CPU').catch(error => {
      if (!this.running || this.lifecycle !== lifecycle) return;
      const detail = error instanceof Error ? error.message : 'The CPU pose model could not start.';
      this.fail(`Camera tracking stopped after CPU recovery failed: ${detail}`);
    });
  }

  private fail(message: string): void {
    if (!this.running) return;
    this.stop();
    this.onError(message);
  }

  private requestFrame = (): void => {
    if (!this.running) return;
    const now = performance.now();
    if (document.hidden) this.resetWatchdog();
    else if (now - this.lastFreshPoseAt >= trackingTimeoutMs) {
      const message = 'Camera tracking stopped responding. Try again to reconnect and restart camera setup.';
      if (this.worker && this.activeDelegate === 'GPU' && !this.cpuFallbackAttempted) this.fallbackToCpu(this.worker);
      else {
        this.fail(message);
        return;
      }
    }
    const interval = 1000 / C.maxInferenceHz;
    if (!this.inFlight && this.workerReady && this.worker && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - this.lastSentAt >= interval) {
      this.inFlight = true;
      this.lastSentAt = now;
      const worker = this.worker;
      createImageBitmap(this.video).then(bitmap => {
        if (!this.running || this.worker !== worker) { bitmap.close(); return; }
        worker.postMessage({ type: 'frame', bitmap, timestampMs: now }, [bitmap]);
      }).catch(error => {
        if (this.worker !== worker) return;
        this.inFlight = false;
        this.fail(error instanceof Error ? error.message : 'The camera frame could not be processed.');
      });
    }
    this.frameHandle = requestAnimationFrame(this.requestFrame);
  };
}
