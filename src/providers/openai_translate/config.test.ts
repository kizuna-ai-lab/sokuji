import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildTranslate, describeTranslate, type TranslateConfig } from './config';
import { TRANSLATE_DEFAULTS, type TranslateSettings } from './settings';

const PAIR = { source: 'ja', target: 'en' };
const shared = (patch: Partial<SharedSettings> = {}): SharedSettings => ({
  pauses: { sourceSeconds: 1.5, translationSeconds: 2 },
  reversed: (d) => d.source === PAIR.target && d.target === PAIR.source,
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-realtime-translate' }],
  ...patch,
});
const SPEAKER: SessionContext = { direction: PAIR, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const build = (patch: Partial<TranslateSettings> = {}, context = SPEAKER, sh = shared()) => buildTranslate(context, { ...TRANSLATE_DEFAULTS, ...patch }, sh) as TranslateConfig;

describe("OpenAI Translate's builder", () => {
  it('runs the one model into the direction\'s target, transcribing with the one transcript model, noise reduction off, over WebSocket (rulings 7, 8, 9)', () => {
    expect(build()).toEqual({
      model: 'gpt-realtime-translate',
      target: 'en',
      transcriptModel: 'gpt-live-transcribe',
      noiseReduction: null,
      silence: { sourceMs: 1500, translationMs: 2000, deferMidSentence: false },
      transport: 'websocket',
    });
  });

  it('sends the chosen noise reduction as its type, and None as null, which turns it off (ruling 9)', () => {
    expect(build({ noiseReduction: 'Near field' }).noiseReduction).toBe('near_field');
    expect(build({ noiseReduction: 'Far field' }).noiseReduction).toBe('far_field');
    expect(build({ noiseReduction: 'None' }).noiseReduction).toBeNull();
  });

  it("builds the participant as the same call on the reversed direction: its target is the pair's source (D17)", () => {
    expect(build({}, PARTICIPANT).target).toBe('ja');
  });

  it('runs a stored WebRTC choice over WebSocket (ruling 1)', () => {
    expect(build({ transportType: 'webrtc' }).transport).toBe('websocket');
  });

  it("builds a leg that does not speak exactly as one that does: the API always speaks, and the adapter drops the audio (ruling 4)", () => {
    expect(build({}, { ...SPEAKER, speech: false })).toEqual(build());
    expect(build({}, { ...SPEAKER, turns: 'manual' })).toEqual(build());
  });

  it('takes each side\'s pause from the shared pair, clamped, and defers mid-sentence only while the display cuts by sentences (choice 4)', () => {
    expect(build({}, SPEAKER, shared({ pauses: { sourceSeconds: 0.01, translationSeconds: 9 } })).silence).toEqual({ sourceMs: 100, translationMs: 3000, deferMidSentence: false });
    expect(build({}, SPEAKER, shared({ segmentation: { mode: 'sentences', sentencesPerRow: 2 } })).silence.deferMidSentence).toBe(true);
    expect(build({}, SPEAKER, shared({ segmentation: { mode: 'off', sentencesPerRow: 0 } })).silence.deferMidSentence).toBe(false);
  });

  it('refuses a target outside the thirteen, in words (a guard the languages never reach)', () => {
    expect(buildTranslate({ ...SPEAKER, direction: { source: 'en', target: 'th' } }, TRANSLATE_DEFAULTS, shared())).toEqual({ refused: 'OpenAI Translate does not translate into th.' });
  });

  it('names the translation model and the transcript model (choice 10)', () => {
    expect(describeTranslate(build())).toEqual({ translationModel: 'gpt-realtime-translate', asrModel: 'gpt-live-transcribe' });
  });
});
