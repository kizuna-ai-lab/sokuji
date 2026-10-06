import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildGemini, describeGemini, type GeminiConfig } from './config';
import { GEMINI_DEFAULTS, type GeminiSettings } from './settings';

const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
const TRANSLATE = 'gemini-3.5-live-translate-preview';
const PAIR = { source: 'en', target: 'ja' };
const shared = (patch: Partial<SharedSettings> = {}): SharedSettings => ({
  pauses: { sourceSeconds: 1.5, translationSeconds: 2 },
  reversed: (d) => d.source === PAIR.target && d.target === PAIR.source,
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: TRANSLATE }, { id: DIALOGUE }],
  ...patch,
});
const SPEAKER: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
/** A leg's config: Gemini's defaults with the dialogue model saved, unless the patch saves another (or none). */
const build = (patch: Partial<GeminiSettings> = {}, context = SPEAKER, sh = shared()) => buildGemini(context, { ...GEMINI_DEFAULTS, model: DIALOGUE, ...patch }, sh) as GeminiConfig;

describe("Gemini's builder", () => {
  it('runs a fresh profile — no model saved — on Live Translate when the key lists it (Gemini/AST2 follow-up, ruling 3)', () => {
    expect(build({ model: '' })).toMatchObject({ model: TRANSLATE, kind: 'translate', translationTargetCode: 'ja' });
    // Without it, the old rule's dialogue model.
    expect(build({ model: '' }, SPEAKER, shared({ models: [{ id: DIALOGUE }] }))).toMatchObject({ model: DIALOGUE, kind: 'dialogue' });
  });

  it('runs a saved dialogue model, speaking, with the Quick prompt for its direction (rulings 2, 4)', () => {
    const c = build();
    expect(c).toMatchObject({ model: DIALOGUE, kind: 'dialogue', voice: 'Aoede', temperature: 0.8 });
    expect(c.instructions).toContain('translate English → Japanese.');
    expect(c.activity).toEqual({ manual: false, start: 'low', end: 'high', silenceMs: 500, prefixMs: 300 });
    for (const absent of ['maxOutputTokens', 'translationTargetCode', 'silence'] as const) expect(c, absent).not.toHaveProperty(absent);
  });

  it("builds Live Translate: its target as the pair holds it — one of its own codes (Gemini/AST2 follow-up, ruling 6) — no voice or sampling, its silence timers from the pauses (ruling 1)", () => {
    const c = build({ model: TRANSLATE, maxTokens: 2048 });
    expect(c).toMatchObject({ model: TRANSLATE, kind: 'translate', translationTargetCode: 'ja', silence: { sourceMs: 1500, translationMs: 2000, deferMidSentence: false } });
    for (const absent of ['voice', 'temperature', 'maxOutputTokens'] as const) expect(c, absent).not.toHaveProperty(absent);
    // The instruction is still sent: it corrects terminology (`geminiTranslateModel.ts:19-24`).
    expect(c.instructions).toBeTruthy();
    expect(build({ model: TRANSLATE }, { ...SPEAKER, direction: { source: 'en', target: 'zh-Hant' } }).translationTargetCode).toBe('zh-Hant');
    expect(build({ model: TRANSLATE }, { ...SPEAKER, direction: { source: 'en', target: 'pt-PT' } }).translationTargetCode).toBe('pt-PT');
  });

  it("builds the participant as the same call on the reversed direction: Other's prompt, the reversed names, the reversed target", () => {
    const advanced = { useTemplateMode: false, systemInstructions: 'mine', participantSystemInstructions: 'theirs' };
    expect(build(advanced).instructions).toBe('mine');
    expect(build(advanced, PARTICIPANT).instructions).toBe('theirs');
    expect(build({ ...advanced, participantSystemInstructions: '  ' }, PARTICIPANT).instructions).toBe('mine');
    expect(build({}, PARTICIPANT).instructions).toContain('translate Japanese → English.');
    expect(build({ model: TRANSLATE }, PARTICIPANT).translationTargetCode).toBe('en');
  });

  it("voices a leg that speaks — the participant too, when its switch is on (ruling 5) — and no leg that does not", () => {
    expect(build({ voice: 'Puck' }, PARTICIPANT).voice).toBe('Puck');
    expect(build({}, { ...PARTICIPANT, speech: false })).not.toHaveProperty('voice');
    expect(build({ voice: '' }).voice).toBe('Aoede');
  });

  it("sets each model family's activity handling: 2.5 no interruption, 3.x barge-in, Live Translate no interruption (Gemini/AST2 follow-up, ruling 5)", () => {
    expect(build().activityHandling).toBe('NO_INTERRUPTION');
    expect(build({ model: 'gemini-3.8-live' }, SPEAKER, shared({ models: [{ id: 'gemini-3.8-live' }] })).activityHandling).toBe('START_OF_ACTIVITY_INTERRUPTS');
    expect(build({ model: TRANSLATE }).activityHandling).toBe('NO_INTERRUPTION');
    // The participant and manual turns alike: it follows the model alone.
    expect(build({ model: 'gemini-3.8-live' }, { ...PARTICIPANT, turns: 'auto' }, shared({ models: [{ id: 'gemini-3.8-live' }] })).activityHandling).toBe('START_OF_ACTIVITY_INTERRUPTS');
    expect(build({}, { ...SPEAKER, turns: 'manual' }).activityHandling).toBe('NO_INTERRUPTION');
  });

  it("refuses in words a Live Translate target outside its 78 — a saved dialogue model no longer listed runs as Live Translate — and sends nothing (Gemini/AST2 follow-up, choice 18)", () => {
    const retired = build({ model: 'gemini-2.0-flash-live-001' }, { ...SPEAKER, direction: { source: 'en', target: 'fo' } });
    expect(retired).toEqual({ refused: 'Live Translate does not translate into Faroese: choose another language, or a dialogue model.' });
    // A dialogue model takes Faroese.
    expect(build({}, { ...SPEAKER, direction: { source: 'en', target: 'fo' } })).toMatchObject({ kind: 'dialogue', model: DIALOGUE });
  });

  it('marks activity itself under manual turns', () => {
    expect(build({}, { ...SPEAKER, turns: 'manual' }).activity).toEqual({ manual: true });
  });

  it('omits a blank prompt', () => {
    expect(build({ useTemplateMode: false, systemInstructions: '   ' })).not.toHaveProperty('instructions');
  });

  it('clamps the knobs, rounding the integer ones, and falls back on a non-finite value', () => {
    expect(build({ temperature: 5 }).temperature).toBe(2);
    expect(build({ temperature: -1 }).temperature).toBe(0);
    expect(build({ temperature: Number.NaN }).temperature).toBe(0.8);
    expect(build({ maxTokens: 99_999 }).maxOutputTokens).toBe(8192);
    expect(build({ maxTokens: 0 }).maxOutputTokens).toBe(1);
    expect(build({ maxTokens: 2048.4 }).maxOutputTokens).toBe(2048);
    // A non-finite maxTokens reads as 'inf' (unlimited): every knob falls back
    // to its default, and the default here omits the field (fix round 1).
    expect(build({ maxTokens: Number.NaN })).not.toHaveProperty('maxOutputTokens');
    expect(build({ vadSilenceDurationMs: 10, vadPrefixPaddingMs: -5 }).activity).toMatchObject({ silenceMs: 50, prefixMs: 0 });
    expect(build({ vadSilenceDurationMs: 99_999, vadPrefixPaddingMs: 5000 }).activity).toMatchObject({ silenceMs: 3000, prefixMs: 2000 });
    expect(build({ vadSilenceDurationMs: 512.6, vadPrefixPaddingMs: 249.5 }).activity).toMatchObject({ silenceMs: 513, prefixMs: 250 });
    expect(build({ vadSilenceDurationMs: Number.NaN, vadPrefixPaddingMs: Number.NaN }).activity).toMatchObject({ silenceMs: 500, prefixMs: 300 });
  });

  it("defers a mid-sentence close while the display cuts by sentences, and clamps the pauses to the timers' range (choice 7)", () => {
    const c = build({ model: TRANSLATE }, SPEAKER, shared({ segmentation: { mode: 'sentences', sentencesPerRow: 2 }, pauses: { sourceSeconds: 0.05, translationSeconds: 10 } }));
    expect(c.silence).toEqual({ sourceMs: 100, translationMs: 3000, deferMidSentence: true });
    // Off never defers: the old sentence stage that fed the deferral never ran under it (`GeminiClient.ts:803, 827`).
    expect(build({ model: TRANSLATE }, SPEAKER, shared({ segmentation: { mode: 'off', sentencesPerRow: 0 } })).silence).toMatchObject({ deferMidSentence: false });
  });

  it('refuses with models_required when there is no model at all, and runs a saved model while nothing is listed', () => {
    expect(buildGemini(SPEAKER, GEMINI_DEFAULTS, shared({ models: [] }))).toEqual({ refused: 'No Gemini Live model is available to this key.', code: 'models_required' });
    expect(build({ model: 'gemini-3.1-flash-live-preview' }, SPEAKER, shared({ models: [] })).model).toBe('gemini-3.1-flash-live-preview');
  });

  it('describes its one model as the translation model (choice 6)', () => {
    expect(describeGemini(build())).toEqual({ translationModel: DIALOGUE });
  });
});

describe("Gemini's builder: transcription only", () => {
  const TO: SessionContext = { ...SPEAKER, translate: false };
  it('asks for no translation, voice or translating prompt', () => {
    const d = build({}, TO);
    expect(d).toMatchObject({ kind: 'dialogue', transcribeOnly: true });
    expect(d.instructions).toContain('silent transcriber');
    for (const absent of ['voice', 'translationTargetCode'] as const) expect(d, absent).not.toHaveProperty(absent);
    const t = build({ model: TRANSLATE }, TO);
    expect(t).toMatchObject({ kind: 'translate', transcribeOnly: true });
    expect(t).not.toHaveProperty('translationTargetCode');
  });
  it('does not refuse a target Live Translate cannot speak', () => {
    const odd: SessionContext = { ...TO, direction: { source: 'en', target: 'tlh' } };
    expect(buildGemini(odd, { ...GEMINI_DEFAULTS, model: TRANSLATE }, shared())).not.toHaveProperty('refused');
  });
  it('leaves a normal leg untouched', () => {
    expect(build()).not.toHaveProperty('transcribeOnly');
  });
});
