/*
 * Adapted from Google's MediaPipe Web Pose Landmarker worker sample:
 * https://github.com/google-ai-edge/mediapipe-samples-web/blob/fa5a2eec5a6a3bed339d872dfd8d7895e1db13f7/src/workers/pose-landmarker.worker.ts
 * Copyright 2026 The MediaPipe Authors. Licensed under Apache-2.0; the upstream
 * LICENSE is retained at third_party/licenses/mediapipe-samples-web-LICENSE.
 * Adaptations: single-person VIDEO mode, origin-served files, transferred camera
 * frames with one request in flight, and a GPU-to-CPU initialization fallback.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark, PoseSample } from '../core/types';

type WorkerRequest =
  | { type: 'init'; wasmUrl: string; modelUrl: string }
  | { type: 'frame'; bitmap: ImageBitmap; timestampMs: number }
  | { type: 'dispose' };

let landmarker: PoseLandmarker | null = null;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'dispose') {
    landmarker?.close();
    landmarker = null;
    return;
  }
  if (message.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks(message.wasmUrl, true);
      try {
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: message.modelUrl, delegate: 'GPU' },
          runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
        });
      } catch (gpuError) {
        console.warn('GPU pose delegate unavailable; using CPU.', gpuError);
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: message.modelUrl, delegate: 'CPU' },
          runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
        });
      }
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The pose model could not be loaded.' });
    }
    return;
  }
  if (!landmarker) {
    message.bitmap.close();
    return;
  }
  try {
    const result = landmarker.detectForVideo(message.bitmap, message.timestampMs);
    const landmarks: Landmark[] = (result.landmarks[0] ?? []).map(point => ({
      x: point.x, y: point.y, z: point.z,
      visibility: point.visibility ?? 0, presence: 1,
    }));
    const sample: PoseSample = {
      timestampMs: message.timestampMs,
      frameWidth: message.bitmap.width,
      frameHeight: message.bitmap.height,
      landmarks,
    };
    self.postMessage({ type: 'pose', sample });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Pose tracking stopped unexpectedly.' });
  } finally {
    message.bitmap.close();
  }
};
