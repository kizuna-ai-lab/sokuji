import { describe, it, expect } from 'vitest';
import { describeResolutionNote } from './resolutionNotes';
import type { ResolutionNote } from '../../../lib/local-inference/selection/types';

// A t() that renders the defaultValue with {{interpolation}} — the same contract
// i18next provides — so tests pin the real copy without loading i18n.
const t = (_key: string, defaultValueOrOpts?: string | Record<string, unknown>, optionalOpts?: Record<string, unknown>): string => {
  let finalOpts: Record<string, unknown>;
  if (typeof defaultValueOrOpts === 'string') {
    finalOpts = { defaultValue: defaultValueOrOpts, ...(optionalOpts || {}) };
  } else {
    finalOpts = defaultValueOrOpts || {};
  }
  return String(finalOpts.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, k) => String(finalOpts[k] ?? ''));
};

const name = (id: string) => ({ 'sensevoice-int8': 'SenseVoice', 'opus-mt-ja-en': 'Opus-MT (ja→en)' }[id] ?? id);

const N = (over: Partial<ResolutionNote>): ResolutionNote => ({
  direction: 'ja→en', stage: 'translation', from: 'opus-mt-ja-en', to: 'sensevoice-int8',
  reason: 'not-downloaded', ...over,
});

describe('describeResolutionNote', () => {
  it('not-downloaded names the pick and the substitute', () => {
    expect(describeResolutionNote(N({}), t as never, name))
      .toBe('Opus-MT (ja→en) is not downloaded — using SenseVoice instead. Download it again to use it.');
  });

  it('lang-incompatible says the pick does not fit this direction', () => {
    expect(describeResolutionNote(N({ reason: 'lang-incompatible' }), t as never, name))
      .toBe('Opus-MT (ja→en) does not support this direction — using SenseVoice instead. It returns when the direction does.');
  });

  it('hardware-gated blames the machine, not the user', () => {
    expect(describeResolutionNote(N({ reason: 'hardware-gated' }), t as never, name))
      .toBe('Opus-MT (ja→en) cannot run on this device — using SenseVoice instead.');
  });

  it('not-in-catalog is terminal copy', () => {
    expect(describeResolutionNote(N({ reason: 'not-in-catalog', to: null }), t as never, name))
      .toBe('Opus-MT (ja→en) is no longer available in this version.');
  });

  it('no-candidate names the missing stage, with no from', () => {
    expect(describeResolutionNote(N({ reason: 'no-candidate', from: null, to: null, stage: 'asr' }), t as never, name))
      .toBe('No speech recognition model is available for this direction.');
  });

  it('falls back to a substitute-free sentence when to is null', () => {
    expect(describeResolutionNote(N({ to: null }), t as never, name))
      .toBe('Opus-MT (ja→en) is not downloaded. Download it again to use it.');
  });
});
