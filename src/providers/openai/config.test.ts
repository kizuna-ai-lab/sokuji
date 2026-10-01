import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { INSTRUCTIONS_TEMPLATE } from '../../lib/provider/instructions';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import { buildRealtime, describeRealtime, type RealtimeConfig } from './config';
import { migrateRealtimeSettings, REALTIME_DEFAULTS, type RealtimeSettings } from './settings';

const PAIR = { source: 'en', target: 'zh-CN' };
const shared = (patch: Partial<SharedSettings> = {}): SharedSettings => ({
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === PAIR.target && d.target === PAIR.source,
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-2.1-mini' }, { id: 'gpt-realtime-mini' }],
  ...patch,
});
const SPEAKER: SessionContext = { direction: PAIR, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'zh-CN', target: 'en' }, speech: false, turns: 'auto' };
const build = (patch: Partial<RealtimeSettings> = {}, context = SPEAKER, sh = shared()) => buildRealtime(context, { ...REALTIME_DEFAULTS, ...patch }, sh) as RealtimeConfig;
const template = (source: string, target: string) => INSTRUCTIONS_TEMPLATE.replace(/\{\{SOURCE_LANGUAGE\}\}/g, source).replace(/\{\{TARGET_LANGUAGE\}\}/g, target);

describe("OpenAI Realtime's builder", () => {
  it('builds the speaker from the defaults: the effective model, the template for its direction, audio in the voice, server VAD in ms, the source hint, noise off, reasoning, WebSocket', () => {
    expect(build()).toEqual({
      model: 'gpt-realtime-2.1-mini',
      instructions: template('English', 'Chinese (China)'),
      modalities: ['audio'],
      voice: 'alloy',
      maxTokens: 'inf',
      turnDetection: { type: 'server_vad', threshold: 0.49, prefixPaddingMs: 500, silenceDurationMs: 500 },
      transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
      noiseReduction: null,
      reasoningEffort: 'low',
      transport: 'websocket',
    });
  });

  it("builds the participant as the reversed call: Other's prompt, the hint for the language it hears, text when it does not speak, and the user's own detection (ruling 4; D17)", () => {
    const s: Partial<RealtimeSettings> = { useTemplateMode: false, systemInstructions: 'Mine.', participantSystemInstructions: "Other's.", transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji', turnDetectionMode: 'Semantic', semanticEagerness: 'Low' };
    const participant = build(s, PARTICIPANT);
    expect(participant).toMatchObject({
      instructions: "Other's.",
      modalities: ['text'],
      transcription: { model: 'gpt-live-transcribe', languages: ['zh'], keywords: ['Sokuji'] },
      turnDetection: { type: 'semantic_vad', eagerness: 'low' },
    });
    expect(participant).not.toHaveProperty('voice');
    // The mechanism and knobs are the user's own setting, not forced by the leg: the default (Normal/server VAD) reaches the participant untouched.
    expect(build({}, PARTICIPANT).turnDetection).toEqual({ type: 'server_vad', threshold: 0.49, prefixPaddingMs: 500, silenceDurationMs: 500 });
    expect(build(s).instructions).toBe('Mine.');
    // Its switch on: it speaks, in the same voice (ruling 15).
    expect(build(s, { ...PARTICIPANT, speech: true })).toMatchObject({ modalities: ['audio'], voice: 'alloy' });
  });

  it('under manual turns asks for no detection: the client commits', () => {
    expect(build({}, { ...SPEAKER, turns: 'manual' }).turnDetection).toBeNull();
    expect(build({ turnDetectionMode: 'Semantic' }, { ...SPEAKER, turns: 'manual' }).turnDetection).toBeNull();
  });

  it("clamps the knobs to the sliders' ranges, and a knob that is no number to its default", () => {
    expect(build({ threshold: 3, prefixPadding: -1, silenceDuration: 9 }).turnDetection).toEqual({ type: 'server_vad', threshold: 1, prefixPaddingMs: 0, silenceDurationMs: 2000 });
    expect(build({ threshold: Number.NaN, prefixPadding: Number.NaN, silenceDuration: Number.NaN }).turnDetection).toEqual({ type: 'server_vad', threshold: 0.49, prefixPaddingMs: 500, silenceDurationMs: 500 });
    expect(build({ maxTokens: 9_000 }).maxTokens).toBe(4096);
    expect(build({ maxTokens: 0 }).maxTokens).toBe(1);
    expect(build({ maxTokens: 2048.4 }).maxTokens).toBe(2048);
    expect(build({ maxTokens: Number.NaN }).maxTokens).toBe('inf');
  });

  it('runs the saved model when listed, else the default model, else the newest; sends reasoning to a gpt-realtime-2* model only; refuses when nothing is listed or saved', () => {
    expect(build({ model: 'gpt-realtime-mini' })).toMatchObject({ model: 'gpt-realtime-mini' });
    expect(build({ model: 'gpt-realtime-mini' })).not.toHaveProperty('reasoningEffort');
    expect(build({ model: 'gpt-realtime-9', reasoningEffort: 'high' })).toMatchObject({ model: 'gpt-realtime-2.1-mini', reasoningEffort: 'high' });
    expect(build({ model: 'gpt-realtime-9' }, SPEAKER, shared({ models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-mini' }] }))).toMatchObject({ model: 'gpt-realtime-2.1' });
    expect(buildRealtime(SPEAKER, { ...REALTIME_DEFAULTS, model: '' }, shared({ models: [] }))).toEqual({ refused: 'No OpenAI Realtime model is available to this key.', code: 'models_required' });
  });

  it('names Auto-detect "the spoken language" in the template, and sends it no language hint (ruling 7)', () => {
    const auto = build({ transcriptModel: 'gpt-live-transcribe' }, { ...SPEAKER, direction: { source: AUTO, target: 'ja' } });
    expect(auto.instructions).toBe(template('the spoken language', 'Japanese'));
    expect(auto.transcription).toEqual({ model: 'gpt-live-transcribe' });
  });

  it('maps noise reduction to the wire, "None" as null (ruling 16), and runs over WebSocket whatever transport was stored: a stored WebRTC choice is not read (ruling 12)', () => {
    expect(build({ noiseReduction: 'Near field' }).noiseReduction).toBe('near_field');
    expect(build({ noiseReduction: 'Far field' }).noiseReduction).toBe('far_field');
    const stored = migrateRealtimeSettings({ transportType: 'webrtc' }, { legacy: {}, credentials: {} });
    expect(stored).not.toHaveProperty('transportType');
    expect((buildRealtime(SPEAKER, stored, shared()) as RealtimeConfig).transport).toBe('websocket');
  });

  it('describes the translation model and the transcript model (choice 20)', () => {
    expect(describeRealtime(build({ transcriptModel: 'gpt-transcribe' }))).toEqual({ translationModel: 'gpt-realtime-2.1-mini', asrModel: 'gpt-transcribe' });
  });
});
