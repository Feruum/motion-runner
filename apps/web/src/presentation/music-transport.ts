/** Original, local Web Audio backing track. No network audio or account is needed. */
export function nextBeatDelayMs(elapsedMs: number, bpm: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('elapsedMs must be a non-negative number');
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('bpm must be a positive number');
  const beatMs = 60_000 / bpm;
  const positionInBeat = elapsedMs % beatMs;
  const epsilon = 1e-7;
  return positionInBeat < epsilon || beatMs - positionInBeat < epsilon ? 0 : beatMs - positionInBeat;
}

export class MusicTransport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private context: AudioContext | null = null;
  private nextBeatAt = 0;
  private nextBeatIndex = 0;
  private readonly voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  private readonly melody = [523.25, 659.25, 783.99, 659.25, 587.33, 783.99, 880, 783.99];

  start(context: AudioContext, bpm = 120, elapsedMs = 0): void {
    this.stop();
    this.context = context;
    const beatSeconds = 60 / bpm;
    const delayToBeatMs = nextBeatDelayMs(elapsedMs, bpm);
    this.nextBeatIndex = Math.round((elapsedMs + delayToBeatMs) / (beatSeconds * 1000));
    this.nextBeatAt = context.currentTime + .06 + delayToBeatMs / 1000;
    const schedule = () => {
      if (!this.context || this.context.state !== 'running') return;
      const horizon = this.context.currentTime + .16;
      while (this.nextBeatAt <= horizon) {
        this.scheduleBeat(this.nextBeatIndex, this.nextBeatAt, beatSeconds);
        this.nextBeatAt += beatSeconds;
        this.nextBeatIndex++;
      }
    };
    schedule();
    this.timer = setInterval(schedule, 35);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(.0001, now, .015);
        voice.oscillator.stop(now + .08);
      } catch { /* A short voice may already have ended. */ }
    }
    this.voices.clear();
    this.context = null;
  }

  private scheduleBeat(index: number, at: number, beatSeconds: number): void {
    const barBeat = index % 4;
    if (barBeat === 0 || barBeat === 2) this.voice(92, 46, at, .18, 'sine');
    if (barBeat === 1 || barBeat === 3) this.voice(175, 115, at, .065, 'triangle');
    this.voice(2400, 2400, at, .012, 'square', .035);
    if (barBeat === 0) {
      const phrase = Math.floor(index / 4) % 4;
      const root = [130.81, 98, 110, 87.31][phrase];
      this.voice(root, root * .75, at, .035, 'triangle', beatSeconds * 1.8);
    }
    const note = this.melody[index % this.melody.length];
    this.voice(note, note, at, .018, 'sine', beatSeconds * .28);
  }

  private voice(startHz: number, endHz: number, at: number, volume: number, type: OscillatorType, duration = .13): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startHz, at);
    if (endHz !== startHz) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), at + Math.min(.12, duration));
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(gain).connect(context.destination);
    const voice = { oscillator, gain };
    this.voices.add(voice);
    oscillator.onended = () => this.voices.delete(voice);
    oscillator.start(at);
    oscillator.stop(at + duration + .02);
  }
}
