import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }) }));

/** What `resolve(src, tgt)` answers for TTS, keyed `${src}>${tgt}`. */
let mockTts: Record<string, string | null> = {};
vi.mock('../../stores/modelStore', () => ({
  useModelStore: Object.assign(
    (select: (s: { modelStatuses: Record<string, string> }) => unknown) => select({ modelStatuses: {} }),
    { getState: () => ({ resolve: (src: string, tgt: string) => ({ asr: null, translation: null, tts: mockTts[`${src}>${tgt}`] ? { modelId: mockTts[`${src}>${tgt}`] } : null, notes: [], prunes: [] }) }) },
  ),
}));

import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../lib/local-inference/modelName';
import { LocalInferenceVoiceSummary } from './LocalInferenceVoiceSummary';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from './settings';

const PAIR = { source: 'ja', target: 'en' };
const named = (leg: 'speaker' | 'participant', voices: LocalInferenceSettings['voices'] = {}) =>
  render(<LocalInferenceVoiceSummary settings={{ ...LOCAL_INFERENCE_DEFAULTS, voices }} update={vi.fn()} pair={PAIR} leg={leg} />).container.textContent;
const short = (id: string) => { const e = getManifestEntry(id)!; return shortenModelName(e.name, e.shortName); };

beforeEach(() => { mockTts = {}; });

describe('LocalInferenceVoiceSummary', () => {
  it("names an Edge voice by its own name, from each leg's direction", () => {
    mockTts = { 'ja>en': 'edge-tts', 'en>ja': 'edge-tts' };
    expect(named('speaker', { 'ja→en': { edge: 'en-US-AvaMultilingualNeural' } })).toBe('Ava Multilingual');
    expect(named('participant', { 'en→ja': { edge: 'ja-JP-NanamiNeural' } })).toBe('Nanami');
  });

  it('names Edge by the model while the direction has no voice yet', () => {
    mockTts = { 'ja>en': 'edge-tts' };
    expect(named('speaker')).toBe(short('edge-tts'));
  });

  it("names a Supertonic preset, the model's default when none is set, and an imported voice as a custom voice", () => {
    mockTts = { 'ja>en': 'supertonic-3' };
    expect(named('speaker', { 'ja→en': { speaker: 1 } })).toBe('Lily');
    expect(named('speaker')).toBe('Robert');
    expect(named('speaker', { 'ja→en': { speaker: 12 } })).toBe('Custom voice');
  });

  it('names a multi-speaker model by its short name and speaker number, and a single-voice model by its short name', () => {
    mockTts = { 'ja>en': 'piper-cy-bu_tts-medium', 'en>ja': 'mimic3-af-google_nwu-low' };
    expect(named('speaker', { 'ja→en': { speaker: 3 } })).toBe(`${short('piper-cy-bu_tts-medium')} #3`);
    expect(named('participant')).toBe(short('mimic3-af-google_nwu-low'));
  });

  it('names nothing when no TTS model resolves for the leg', () => {
    mockTts = { 'ja>en': 'edge-tts' };
    expect(named('participant')).toBe('');
  });
});
