import { describe, expect, it } from 'vitest';
import { mirrorCoachState, type MirrorCoachState } from '../src/presentation/mirror-coach-state';
import { MirrorCoachVoice, type MirrorCoachSpeechAdapter } from '../src/presentation/mirror-coach-voice';

function state(overrides: Partial<MirrorCoachState> = {}): MirrorCoachState {
  return { ...mirrorCoachState(null, 0), ...overrides };
}

function speechRecorder() {
  const spoken: string[] = [];
  const cancelled: number[] = [];
  const adapter: MirrorCoachSpeechAdapter = {
    speak: text => spoken.push(text),
    cancel: () => cancelled.push(cancelled.length + 1),
  };
  return { adapter, spoken, cancelled };
}

describe('Mirror coach voice', () => {
  it('speaks a phase and target once while holding progress changes', () => {
    const recorder = speechRecorder();
    const voice = new MirrorCoachVoice(recorder.adapter);
    const initial = state({ instruction: 'Match: Lean left.' });

    voice.update(initial, true);
    voice.update({ ...initial, holdingMs: 100, instruction: 'Hold: Lean left.' }, true);
    voice.update({ ...initial, holdingMs: 350, instruction: 'Hold: Lean left.' }, true);

    expect(recorder.spoken).toEqual(['Match: Lean left.']);
    expect(voice.supported).toBe(true);
    voice.dispose();
  });

  it('speaks again when the task, phase, or combo element changes', () => {
    const recorder = speechRecorder();
    const voice = new MirrorCoachVoice(recorder.adapter);
    const initial = state({ instruction: 'Watch: Lean left.' });

    voice.update(initial, true);
    voice.update({ ...initial, elementIndex: 1, action: 'RIGHT', instruction: 'Watch: Lean right.' }, true);
    voice.update({ ...initial, taskIndex: 1, instruction: 'Watch: Lean left.' }, true);
    voice.update({ ...initial, phase: 'attempt', instruction: 'Match: Lean left.' }, true);

    expect(recorder.spoken).toEqual([
      'Watch: Lean left.',
      'Watch: Lean right.',
      'Watch: Lean left.',
      'Match: Lean left.',
    ]);
    expect(recorder.cancelled.length).toBe(4);
    voice.dispose();
  });

  it('cancels on pause and mute, then speaks the current instruction once on recovery', () => {
    const recorder = speechRecorder();
    const voice = new MirrorCoachVoice(recorder.adapter);
    const current = state({ instruction: 'Match: Lean left.' });

    voice.update(current, true);
    voice.update(current, false);
    voice.update(current, false);
    voice.update(current, true);
    voice.setEnabled(false);
    voice.update(current, true);
    voice.setEnabled(true);
    voice.update(current, true);

    expect(recorder.spoken).toEqual([
      'Match: Lean left.',
      'Match: Lean left.',
      'Match: Lean left.',
    ]);
    expect(recorder.cancelled.length).toBe(5);

    voice.dispose();
    expect(recorder.cancelled.length).toBe(6);
  });

  it('handles browsers without speech synthesis as text-only', () => {
    const voice = new MirrorCoachVoice(null);
    expect(voice.supported).toBe(false);
    expect(() => {
      voice.update(state(), true);
      voice.setEnabled(false);
      voice.setEnabled(true);
      voice.dispose();
    }).not.toThrow();
  });

  it('does not retry a failed speech command on every frame', () => {
    let attempts = 0;
    const voice = new MirrorCoachVoice({
      speak: () => { attempts += 1; throw new Error('speech unavailable'); },
      cancel: () => {},
    });
    const current = state({ instruction: 'Match: Lean left.' });

    voice.update(current, true);
    voice.update(current, true);
    voice.update(current, true);
    expect(attempts).toBe(1);

    voice.update({ ...current, taskIndex: 1 }, true);
    expect(attempts).toBe(2);

    voice.update(current, false);
    voice.update(current, true);
    expect(attempts).toBe(3);
  });
});
