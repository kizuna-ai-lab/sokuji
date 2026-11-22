import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { directionKey } from '../../lib/local-inference/selection/types';
import type { SharedSettings } from '../../lib/provider/types';
import type { EdgeSettings } from './settings';
import { edgeSpeaks, edgeSpeechUnit } from './unit';

const shared: SharedSettings = { pauses: { sourceSeconds: 0, translationSeconds: 0 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [] };
const build = (s: EdgeSettings, direction: SessionContext['direction'], o: { speech?: boolean } = {}) =>
  edgeSpeechUnit.build({ direction, speech: o.speech ?? true, turns: 'auto' }, s, shared);

describe("Edge's speech unit", () => {
  it('occupies speech alone', () => {
    expect(edgeSpeechUnit.id).toBe('speech');
    expect(edgeSpeechUnit.occupies({ voices: {}, speed: 1 }, new Set(['speech']))).toEqual(['speech']);
    expect(edgeSpeechUnit.occupies({ voices: {}, speed: 1 }, new Set(['translation', 'speech']))).toBeNull();
  });

  it('declares what the local speech unit does', () => {
    const c = edgeSpeechUnit.capabilities({ voices: {}, speed: 1 });
    expect(c).toMatchObject({ speech: 'optional', boundaries: 'silence', faceToFace: true, participantSpeech: true });
    expect(c.speaks).toBe(edgeSpeaks);
  });

  it("builds each leg with its own direction's voice", () => {
    const s = { voices: { [directionKey('en', 'ja')]: 'ja-JP-NanamiNeural', [directionKey('ja', 'en')]: 'en-US-JennyNeural' }, speed: 1 };
    expect(build(s, { source: 'en', target: 'ja' })).toMatchObject({ modelId: 'edge-tts', speakerId: 0, speed: 1, edgeVoice: 'ja-JP-NanamiNeural' });
    expect(build(s, { source: 'ja', target: 'en' })).toMatchObject({ edgeVoice: 'en-US-JennyNeural' });
    expect(build(s, { source: 'en', target: 'ja' }, { speech: false })).toEqual({ off: true });
  });

  it('leaves the voice out while the direction has none', () => {
    expect(build({ voices: {}, speed: 1.3 }, { source: 'en', target: 'ja' })).toEqual({ modelId: 'edge-tts', speakerId: 0, speed: 1.3 });
  });

  it('names the Edge model', () => {
    expect(edgeSpeechUnit.describe({ modelId: 'edge-tts', speakerId: 0, speed: 1 })).toEqual({ ttsModel: 'edge-tts' });
    expect(edgeSpeechUnit.describe({ off: true })).toEqual({});
  });

  it('speaks the languages Edge has voices for', () => {
    expect(edgeSpeaks('ja')).toBe(true);
    expect(edgeSpeaks('pt-BR')).toBe(true);
    expect(edgeSpeaks('xx')).toBe(false);
  });
});
