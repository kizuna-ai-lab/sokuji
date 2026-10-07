import { describe, it, expect } from 'vitest';
import { parseCode } from '../../lib/language/code';
import { AUTO } from '../../lib/provider/languages';
import { LOCAL_INFERENCE_DEFAULTS, localInferenceLanguages } from './settings';

describe('LOCAL_INFERENCE_DEFAULTS', () => {
  it('pads speech with the 0.8 s every vad-web worker used before the setting existed', () => {
    expect(LOCAL_INFERENCE_DEFAULTS.vadPreSpeechPadDuration).toBe(0.8);
  });

  it('starts on Normal, with Smart Turn checking after 0.30 s at 0.50', () => {
    expect(LOCAL_INFERENCE_DEFAULTS.vadEndOfTurn).toBe('normal');
    expect(LOCAL_INFERENCE_DEFAULTS.smartTurnCheckAfter).toBe(0.3);
    expect(LOCAL_INFERENCE_DEFAULTS.smartTurnThreshold).toBe(0.5);
  });
});

describe('localInferenceLanguages', () => {
  it('never offers AUTO as a source', () => {
    const sources = localInferenceLanguages.sources(LOCAL_INFERENCE_DEFAULTS);
    expect(sources.map((s) => s.value)).not.toContain(AUTO);
  });

  it('offers a target for every source', () => {
    const sources = localInferenceLanguages.sources(LOCAL_INFERENCE_DEFAULTS);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      const targets = localInferenceLanguages.targets(source.value, LOCAL_INFERENCE_DEFAULTS);
      expect(targets.length, source.value).toBeGreaterThan(0);
    }
  });

  it('starts at ja → en', () => {
    expect(localInferenceLanguages.initial?.(LOCAL_INFERENCE_DEFAULTS)).toEqual({ source: 'ja', target: 'en' });
  });

  it('offers app codes only, with no names', () => {
    const sources = localInferenceLanguages.sources(LOCAL_INFERENCE_DEFAULTS);
    for (const o of sources) {
      expect(parseCode(o.value), o.value).not.toBeNull();
      expect(o).toEqual({ value: o.value });
    }
    expect(localInferenceLanguages.wire?.toWire('yue')).toBe('yue');
  });
});
