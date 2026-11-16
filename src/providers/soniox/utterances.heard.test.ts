// Soniox times its final original words in stream time; with a table to the run's clock they become heard pieces.
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { SonioxToken } from './sttStream';
import { Utterances, type SegmentEvent, type UtteranceOptions } from './utterances';

const orig = (text: string, more: Partial<SonioxToken> = {}): SonioxToken => ({ text, is_final: false, translation_status: 'original', language: 'en', ...more });

function make(o: Partial<Pick<UtteranceOptions, 'heardAt'>>) {
  const segments: SegmentEvent[] = [];
  const machine = new Utterances({
    clock: createVirtualClock(0), legFor: () => 'speaker', targetFor: () => 'ja',
    sink: { segment: (_leg, s) => segments.push(s), speak: () => {}, endSpeech: () => {} },
    ...o,
  });
  const lastSourceText = () => {
    const texts = segments.filter((s): s is Extract<SegmentEvent, { kind: 'segmentText' }> => s.kind === 'segmentText' && s.payload.ref === 1);
    return texts[texts.length - 1];
  };
  return { machine, lastSourceText };
}

describe('Utterances — heard', () => {
  it('turns final original tokens into heard pieces and reports the stable length', () => {
    const { machine, lastSourceText } = make({ heardAt: (ms) => 50_000 + ms });
    machine.message([orig('Hel', { is_final: true, start_ms: 0, end_ms: 200 }), orig('lo', { is_final: true, start_ms: 200, end_ms: 380 }), orig(' wor', { start_ms: 400, end_ms: 600 })]);
    expect(lastSourceText().payload).toEqual(expect.objectContaining({
      text: 'Hello wor',
      heard: { pieces: [{ at: 0, len: 3, startAt: 50_000, endAt: 50_200 }, { at: 3, len: 2, startAt: 50_200, endAt: 50_380 }], stableLen: 5 },
    }));
  });

  it('states nothing heard without a table, and skips a token whose time the table cannot place', () => {
    const plain = make({});
    plain.machine.message([orig('Hi', { is_final: true, start_ms: 0, end_ms: 100 })]);
    expect(plain.lastSourceText().payload.heard).toBeUndefined();
    const partial = make({ heardAt: (ms) => (ms < 1000 ? ms : undefined) });
    partial.machine.message([orig('a', { is_final: true, start_ms: 0, end_ms: 100 }), orig('b', { is_final: true, start_ms: 5000, end_ms: 5100 })]);
    expect(partial.lastSourceText().payload.heard).toEqual({ pieces: [{ at: 0, len: 1, startAt: 0, endAt: 100 }], stableLen: 2 });
  });

  it('sends the stable length again when it grows without a new piece', () => {
    const { machine, lastSourceText } = make({ heardAt: (ms) => (ms < 1000 ? ms : undefined) });
    machine.message([orig('a', { is_final: true, start_ms: 0, end_ms: 100 })]);
    machine.message([orig('b', { is_final: true, start_ms: 5000, end_ms: 5100 })]);
    expect(lastSourceText().payload).toEqual(expect.objectContaining({ text: 'ab', heard: { pieces: [{ at: 0, len: 1, startAt: 0, endAt: 100 }], stableLen: 2 } }));
  });
});
