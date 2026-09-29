import type { MirrorCoachState } from './mirror-coach-state';

export interface MirrorCoachSpeechAdapter {
  speak(text: string): void;
  cancel(): void;
}

function browserSpeechAdapter(): MirrorCoachSpeechAdapter | null {
  if (typeof window === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return null;
  const synthesis = window.speechSynthesis;
  if (!synthesis || typeof synthesis.speak !== 'function' || typeof synthesis.cancel !== 'function') return null;

  return {
    speak(text) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      synthesis.speak(utterance);
    },
    cancel() {
      synthesis.cancel();
    },
  };
}

/** Speaks one concise instruction for each Mirror task, phase, action, and element. */
export class MirrorCoachVoice {
  private enabled = true;
  private lastKey: string | null = null;
  private disposed = false;

  constructor(private readonly adapter: MirrorCoachSpeechAdapter | null = browserSpeechAdapter()) {}

  get supported(): boolean {
    return this.adapter !== null;
  }

  update(state: MirrorCoachState | null, active: boolean): void {
    if (this.disposed) return;
    if (!active || !state || !this.enabled || !this.adapter) {
      this.cancelCurrent();
      return;
    }

    const key = `${state.taskIndex}:${state.phase}:${state.action}:${state.elementIndex}`;
    if (key === this.lastKey) return;

    this.cancelAdapter();
    this.lastKey = key;
    try {
      this.adapter.speak(state.instruction);
    } catch {
      // Keep the key so a failed browser call is not retried on every frame.
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.cancelCurrent();
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelCurrent();
    this.disposed = true;
  }

  private cancelCurrent(): void {
    if (this.lastKey !== null) this.cancelAdapter();
    this.lastKey = null;
  }

  private cancelAdapter(): void {
    try {
      this.adapter?.cancel();
    } catch {
      // Cancel failures must not interrupt the game presentation.
    }
  }
}
