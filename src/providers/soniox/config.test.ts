import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildSoniox, describeSoniox, describeSonioxTts, sonioxTts } from './config';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';

const AUTO_CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };

// leased.test.ts:36-43's literal.
const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (direction) => direction.source === 'ja',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};

const build = (patch: Partial<SonioxSettings> = {}, context: SessionContext = AUTO_CTX) =>
  buildSoniox(context, { ...SONIOX_DEFAULTS, ...patch }, SHARED);
/** The voice and speed a leg's speech unit is built with. */
const voice = (patch: Partial<SonioxSettings> = {}, context: SessionContext = AUTO_CTX) =>
  sonioxTts(context, { ...SONIOX_DEFAULTS, ...patch }, SHARED);

describe('buildSoniox — stt', () => {
  it('builds stt-rt-v6 with no context and the server-default knobs at defaults', () => {
    expect(build().stt).toEqual({
      model: 'stt-rt-v6',
      endpointSensitivity: 0,
      endpointLatencyAdjustmentLevel: 0,
      endpointMaxDelayMs: 2000,
    });
  });

  it('sends the word list as terms and translations, and the session background as text', () => {
    const words = { entries: [{ written: 'Sokuji' }, { written: 'Kizuna AI', translation: 'キズナAI', heardAs: 'kizuna eye' }], background: '  Quarterly review. ' };
    expect(buildSoniox(AUTO_CTX, SONIOX_DEFAULTS, { ...SHARED, words }).stt.context).toEqual({
      terms: ['Sokuji', 'Kizuna AI'],
      translation_terms: [{ source: 'Kizuna AI', target: 'キズナAI' }],
      text: 'Quarterly review.',
    });
  });

  it('sends no context without a word list, whatever old vocabulary is still stored (no migration)', () => {
    const old = { ...SONIOX_DEFAULTS, vocabularyTerms: 'Sokuji', vocabularyTranslations: 'a=b', contextText: 'Agenda' } as SonioxSettings;
    expect(buildSoniox(AUTO_CTX, old, SHARED).stt.context).toBeUndefined();
  });

  it('clamps the knobs, rounds the integer ones, and falls back on non-finite input', () => {
    const hi = build({ endpointSensitivity: 5, endpointLatencyAdjustmentLevel: 2.6, endpointMaxDelayMs: 99_999 });
    expect(hi.stt.endpointSensitivity).toBe(1);
    expect(hi.stt.endpointLatencyAdjustmentLevel).toBe(3);
    expect(hi.stt.endpointMaxDelayMs).toBe(3000);

    // The lower bounds (SonioxProviderConfig.test.ts:106-113).
    const lo = build({ endpointSensitivity: -5, endpointLatencyAdjustmentLevel: -2, endpointMaxDelayMs: 100 });
    expect(lo.stt.endpointSensitivity).toBe(-1);
    expect(lo.stt.endpointLatencyAdjustmentLevel).toBe(0);
    expect(lo.stt.endpointMaxDelayMs).toBe(500);

    const bad = build({ endpointMaxDelayMs: Number.NaN });
    expect(bad.stt.endpointMaxDelayMs).toBe(2000);
  });

  it('builds no voice, whether the leg speaks or not: the voice is the speech unit\'s', () => {
    expect(build()).not.toHaveProperty('tts');
    expect(build({}, { ...AUTO_CTX, speech: false })).toEqual(build());
  });

});

describe('sonioxTts: the voice and speed of a leg\'s speech', () => {
  it("is the leg's voice: the region's for the speaker, the participant's own for the participant", () => {
    const speaker: SessionContext = { ...AUTO_CTX, direction: { source: 'en', target: 'ja' } };
    expect(voice({ region: 'jp', voiceJp: 'Clone-UUID' }, speaker)).toEqual({ voice: 'Clone-UUID', speed: 1 });
    expect(voice({ region: 'jp', voiceJp: 'Clone-UUID' })).toEqual({ voice: 'Grace', speed: 1 });
    expect(voice({ region: 'in', voiceIn: 'Clone-IN' }, speaker)).toEqual({ voice: 'Clone-IN', speed: 1 });
    expect(voice({ region: 'eu', voiceEu: '' }, speaker).voice).toBe('Adrian');
    // The participant's choice is the speaker's own: the other default.
    expect(voice({ voice: 'Grace' }).voice).toBe('Adrian');
  });

  it('clamps the speed, and falls back on non-finite input', () => {
    expect(voice({ ttsSpeed: 9 }).speed).toBe(1.3);
    expect(voice({ ttsSpeed: 0.1 }).speed).toBe(0.7);
    expect(voice({ ttsSpeed: Number.POSITIVE_INFINITY }).speed).toBe(1);
  });
});

describe('buildSoniox — sharedBoth', () => {
  it('carries the shared-Both choice', () => {
    expect(build({ bothModeSharedSession: false }).sharedBoth).toBe(false);
    expect(build().faceToFace).toBeUndefined();
  });

  it('is always shared in face-to-face, and says so', () => {
    const c = buildSoniox(AUTO_CTX, { ...SONIOX_DEFAULTS, bothModeSharedSession: false }, { ...SHARED, faceToFace: true });
    expect(c.sharedBoth).toBe(true);
    expect(c.faceToFace).toBe(true);
  });
});

describe('buildSoniox — diarize', () => {
  it("labels people on the participant's leg only", () => {
    expect(build().diarize).toBe(true);
    expect(build({}, { ...AUTO_CTX, direction: { source: 'en', target: 'ja' } }).diarize).toBe(false);
  });

  it("labels nobody when speaker labels are off, the participant's leg included", () => {
    expect(build({ speakerLabels: false }).diarize).toBe(false);
  });
});

describe('describeSoniox', () => {
  it('describes the STT model alone, whether the leg speaks or not; the speech model is the voice\'s to name', () => {
    expect(describeSoniox(build())).toEqual({ asrModel: 'stt-rt-v6' });
    expect(describeSoniox(build({}, { ...AUTO_CTX, speech: false }))).toEqual({ asrModel: 'stt-rt-v6' });
    expect(describeSonioxTts()).toEqual({ ttsModel: 'tts-rt-v2' });
  });
});

describe('buildSoniox — agent text (spec 2026-11-05 §4.3)', () => {
  const SPEAKER: SessionContext = { ...AUTO_CTX, direction: { source: 'en', target: 'ja' } };
  const SPEAKS = { ...SHARED, speaks: true };
  it("asks on the speaker's leg of a run that speaks with the setting on, even when that leg itself is text-only", () => {
    expect(SONIOX_DEFAULTS.agentText).toBe(true);
    expect(buildSoniox(SPEAKER, SONIOX_DEFAULTS, SPEAKS).stt.agentText).toBe(true);
    expect(buildSoniox({ ...SPEAKER, speech: false }, SONIOX_DEFAULTS, SPEAKS).stt.agentText).toBe(true);
  });
  it("never on the participant's leg: its socket does not hear the microphone", () => {
    expect(buildSoniox(AUTO_CTX, SONIOX_DEFAULTS, SPEAKS).stt).not.toHaveProperty('agentText');
  });
  it('never with the setting off, though the run speaks', () => {
    expect(buildSoniox(SPEAKER, { ...SONIOX_DEFAULTS, agentText: false }, SPEAKS).stt).not.toHaveProperty('agentText');
  });
  it('never in a run where nothing speaks, the setting on', () => {
    for (const speaks of [false, undefined]) expect(buildSoniox(SPEAKER, SONIOX_DEFAULTS, { ...SHARED, speaks }).stt).not.toHaveProperty('agentText');
  });
});
