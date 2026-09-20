import { describe, it, expect } from 'vitest';
import {
  SegmentationCounters,
  emptySegmentationTally,
  instrumentSegmentation,
  segmentationTelemetry,
} from './segmentationTelemetry';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

function tallyOf(build: (counters: SegmentationCounters) => void) {
  const counters = new SegmentationCounters();
  build(counters);
  return counters.snapshot();
}

describe('segmentationTelemetry', () => {
  it('counts seals by reason, per leg', () => {
    const tally = tallyOf((c) => {
      for (let i = 0; i < 12; i++) {
        c.record('speaker', { kind: 'seal', reason: 'sentences', lang: 'ja', chars: 40, terminals: 2 });
      }
      for (let i = 0; i < 3; i++) {
        c.record('speaker', { kind: 'seal', reason: 'length', lang: 'ja', chars: 40, terminals: 0 });
      }
      c.record('speaker', { kind: 'seal', reason: 'end', lang: 'ja', chars: 10, terminals: 0 });
      c.record('participant', { kind: 'seal', reason: 'sentences', lang: 'en', chars: 100, terminals: 2 });
    });

    expect(segmentationTelemetry(tally).segmentation_seals).toEqual({
      speaker_sentences: 12,
      speaker_length: 3,
      speaker_end: 1,
      participant_sentences: 1,
    });
  });

  it('counts model calls per leg', () => {
    const tally = tallyOf((c) => {
      c.record('speaker', { kind: 'model_call' });
      c.record('speaker', { kind: 'model_call' });
      c.record('participant', { kind: 'model_call' });
    });

    expect(segmentationTelemetry(tally).segmentation_model_calls).toEqual({
      speaker: 2,
      participant: 1,
    });
  });

  it('computes sentence terminals per 100 characters, per leg, ASR model and language', () => {
    // Two Japanese seals on the speaker leg: 3 terminals in 200 raw characters
    // is 1.5 per 100. The participant leg ran a different model on English.
    const tally = tallyOf((c) => {
      c.record('speaker', { kind: 'seal', reason: 'sentences', lang: 'ja', chars: 120, terminals: 2 });
      c.record('speaker', { kind: 'seal', reason: 'length', lang: 'ja', chars: 80, terminals: 1 });
      c.record('participant', { kind: 'definite', lang: 'en', chars: 400, terminals: 10 });
    });

    expect(segmentationTelemetry(tally, {
      speaker: 'qwen3-asr-0.6b-webgpu',
      participant: 'voxtral-mini-4b-webgpu',
    }).segmentation_terminals_per_100).toEqual({
      'speaker_qwen3-asr-0.6b-webgpu_ja': 1.5,
      'participant_voxtral-mini-4b-webgpu_en': 2.5,
    });
  });

  it('keeps one bucket per language, so a session that switched languages reports both', () => {
    const tally = tallyOf((c) => {
      c.record('speaker', { kind: 'seal', reason: 'sentences', lang: 'ja', chars: 100, terminals: 4 });
      c.record('speaker', { kind: 'seal', reason: 'sentences', lang: 'zh', chars: 100, terminals: 0 });
    });

    expect(segmentationTelemetry(tally, { speaker: 'whisper-tiny' }).segmentation_terminals_per_100).toEqual({
      'speaker_whisper-tiny_ja': 4,
      'speaker_whisper-tiny_zh': 0,
    });
  });

  it('says unknown for a leg whose provider names no ASR model of its own', () => {
    const tally = tallyOf((c) => {
      c.record('speaker', { kind: 'definite', lang: 'ja', chars: 50, terminals: 1 });
    });

    expect(segmentationTelemetry(tally).segmentation_terminals_per_100).toEqual({
      speaker_unknown_ja: 2,
    });
  });

  it('carries counts only: every value is a number and no key or value holds a space', () => {
    // Model ids and language tags reach this from provider config, so a value
    // with a space in it is reachable — and a space in a PostHog property key
    // is a query the analyst cannot write.
    const tally = tallyOf((c) => {
      c.record('speaker', { kind: 'seal', reason: 'sentences', lang: 'zh Hans', chars: 60, terminals: 1 });
      c.record('speaker', { kind: 'model_call' });
    });

    const props = segmentationTelemetry(tally, { speaker: 'some model v2' });
    const entries = [
      ...Object.entries(props.segmentation_seals ?? {}),
      ...Object.entries(props.segmentation_model_calls ?? {}),
      ...Object.entries(props.segmentation_terminals_per_100 ?? {}),
    ];
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect(typeof value).toBe('number');
      expect(key).not.toMatch(/\s/);
      expect(String(value)).not.toMatch(/\s/);
    }
    expect(props.segmentation_terminals_per_100).toEqual({ 'speaker_some_model_v2_zh_Hans': 1.7 });
  });

  it('reports nothing at all for a session the stage never ran in', () => {
    expect(segmentationTelemetry(emptySegmentationTally())).toEqual({});
  });

  it('drops a bucket that saw no characters, rather than dividing by zero', () => {
    const tally = tallyOf((c) => {
      c.record('speaker', { kind: 'seal', reason: 'end', lang: 'ja', chars: 0, terminals: 0 });
    });
    const props = segmentationTelemetry(tally);
    expect(props.segmentation_seals).toEqual({ speaker_end: 1 });
    expect(props.segmentation_terminals_per_100).toBeUndefined();
  });

  it('starts a fresh tally on reset, so one session never reports another session', () => {
    const counters = new SegmentationCounters();
    counters.record('speaker', { kind: 'model_call' });
    counters.reset();
    expect(segmentationTelemetry(counters.snapshot())).toEqual({});
  });

  it('snapshots by value, so counting on after the read cannot rewrite what was reported', () => {
    const counters = new SegmentationCounters();
    counters.record('speaker', { kind: 'model_call' });
    const taken = counters.snapshot();
    counters.record('speaker', { kind: 'model_call' });
    expect(segmentationTelemetry(taken).segmentation_model_calls).toEqual({ speaker: 1 });
  });
});

describe('instrumentSegmentation', () => {
  const answer = { text: 'a.', sentenceEnds: [2], breakpoints: [2], model: 'sat-3l-sm' as const };

  function fakeRuntime(): SegmentationRuntime & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      enabled: true,
      punctuate: async (lang: string, text: string) => {
        calls.push(`${lang}:${text}`);
        return answer;
      },
    };
  }

  it('is null for a leg with no runtime, which is what "the stage is off" means', () => {
    expect(instrumentSegmentation(null, 'speaker', () => {})).toBeNull();
  });

  it('counts one model call per punctuate and still returns the runtime answer untouched', async () => {
    const runtime = fakeRuntime();
    const counters = new SegmentationCounters();
    const wrapped = instrumentSegmentation(runtime, 'participant', (leg, event) => counters.record(leg, event))!;

    await expect(wrapped.punctuate('ja', 'text')).resolves.toBe(answer);
    expect(runtime.calls).toEqual(['ja:text']);
    expect(segmentationTelemetry(counters.snapshot()).segmentation_model_calls).toEqual({ participant: 1 });
  });

  it('follows the live runtime\'s enabled flag rather than freezing it', () => {
    // The clients freeze `enabled` themselves (R2). Freezing it a second time
    // here would move that decision away from the client that owns it.
    let on = false;
    const wrapped = instrumentSegmentation(
      { get enabled() { return on; }, punctuate: async () => null },
      'speaker',
      () => {},
    )!;
    expect(wrapped.enabled).toBe(false);
    on = true;
    expect(wrapped.enabled).toBe(true);
  });

  it('tags every observation with its own leg', () => {
    const seen: string[] = [];
    const wrapped = instrumentSegmentation(fakeRuntime(), 'participant', (leg, event) => {
      seen.push(`${leg}:${event.kind}`);
    })!;
    wrapped.observe!({ kind: 'seal', reason: 'sentences', lang: 'ja', chars: 10, terminals: 1 });
    expect(seen).toEqual(['participant:seal']);
  });
});
