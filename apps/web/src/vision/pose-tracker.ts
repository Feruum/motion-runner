import { CONFIG as C } from '@motion-runner/game';
import type { PoseSample } from '@motion-runner/game';

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'pose'; sample: PoseSample }
  | { type: 'error'; message: string };

export class PoseTracker {
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private inFlight = false;
  private lastSentAt = -Infinity;
  private frameHandle = 0;
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onPose: (sample: PoseSample) => void,
    private readonly onError: (message: string) => void,
  ) {}

  async start(): Promise<void> {
    this.stop();
    this.running = true;
    const workerReady = new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === 'ready') {
          resolve();
          return;
        }
        if (message.type === 'pose') {
          this.inFlight = false;
          this.onPose(message.sample);
          return;
        }
        this.inFlight = false;
        if (this.readyPromise) reject(new Error(message.message));
        else this.onError(message.message);
      };
      this.worker.onerror = event => {
        this.inFlight = false;
        reject(new Error(event.message || 'The pose model worker could not start.'));
      };
      this.worker.postMessage({
        type: 'init',
        wasmUrl: new URL(`${import.meta.env.BASE_URL}wasm/`, window.location.href).href,
        modelUrl: new URL(`${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`, window.location.href).href,
      });
    });
    this.readyPromise = workerReady;
    const cameraAccess = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
    });
    try {
      const [stream] = await Promise.all([cameraAccess, workerReady]);
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      this.readyPromise = null;
      this.requestFrame();
    } catch (error) {
      void cameraAccess.then(value => value.getTracks().forEach(track => track.stop())).catch(() => undefined);
      this.readyPromise = null;
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = false;
    this.lastSentAt = -Infinity;
    this.readyPromise = null;
  }

  private requestFrame = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const interval = 1000 / C.maxInferenceHz;
    if (!this.inFlight && this.worker && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - this.lastSentAt >= interval) {
      this.inFlight = true;
      this.lastSentAt = now;
      createImageBitmap(this.video).then(bitmap => {
        if (!this.running || !this.worker) { bitmap.close(); this.inFlight = false; return; }
        this.worker.postMessage({ type: 'frame', bitmap, timestampMs: now }, [bitmap]);
      }).catch(error => {
        this.inFlight = false;
        if (this.running) this.onError(error instanceof Error ? error.message : 'The camera frame could not be processed.');
      });
    }
    this.frameHandle = requestAnimationFrame(this.requestFrame);
  };
}
