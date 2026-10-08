/**
 * Gemini Live's wire, spoken directly (Stage 2 Gemini, ruling 7): the
 * URL, the one `setup` frame, the `realtimeInput` frames, and the server's
 * frames decoded at once. The shapes are the SDK's own converter's output
 * (`@google/genai` 2.16.0, `liveConnectConfigToMldev$1`,
 * `dist/web/index.mjs:8548-8682`), pinned by `wire.oracle.test.ts`. The SDK
 * is imported for its server types only (choice 10). Pure: no socket, no
 * timer.
 */
import type {
  LiveServerContent, LiveServerGoAway, LiveServerSessionResumptionUpdate, LiveServerSetupComplete, UsageMetadata,
} from '@google/genai';
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { GeminiConfig } from './config';

/** Lifted to the contract at their third user (Stage 2 OpenAI Realtime, choice 1); re-exported, so this wire's importers are unchanged. */
export { base64ToPcm, pcmToBase64 } from '../../lib/contract/pcm64';

/** The documented Live endpoint, `v1beta` (choice 11): the SDK writes `…com//ws/…`. */
export const GEMINI_LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** The key rides in the query: a browser WebSocket carries no header (survey §1.4). The Logs never see this URL. */
export function liveUrl(apiKey: string): string {
  return `${GEMINI_LIVE_URL}?key=${encodeURIComponent(apiKey)}`;
}

/** The contract's audio (24 kHz mono Int16) as the Live API names it; the server resamples (`GeminiClient.ts:1627-1632`). */
export const INPUT_MIME = `audio/pcm;rate=${SAMPLE_RATE}`;

type Sensitivity<P extends 'START' | 'END'> = `${P}_SENSITIVITY_HIGH` | `${P}_SENSITIVITY_LOW`;

/** The `setup` frame, wire-shaped: the SDK's `LiveClientSetup` with its enums as the strings they are. */
export interface GeminiSetup {
  setup: {
    model: string;
    generationConfig: {
      responseModalities: Array<'AUDIO'>;
      temperature?: number;
      maxOutputTokens?: number;
      speechConfig?: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
      translationConfig?: { targetLanguageCode: string; echoTargetLanguage: boolean };
    };
    systemInstruction?: { parts: Array<{ text: string }> };
    inputAudioTranscription: Record<string, never>;
    outputAudioTranscription?: Record<string, never>;
    realtimeInputConfig: {
      activityHandling: GeminiConfig['activityHandling'];
      automaticActivityDetection:
        | { disabled: true }
        | { disabled: false; startOfSpeechSensitivity: Sensitivity<'START'>; endOfSpeechSensitivity: Sensitivity<'END'>; silenceDurationMs: number; prefixPaddingMs: number };
    };
    sessionResumption: { handle?: string };
    contextWindowCompression: { slidingWindow: Record<string, never> };
  };
}

/** The setup a leg sends on each connection; `handle` resumes a session (ruling 3), `null` opens a fresh one. */
export function setupFrame(c: GeminiConfig, handle: string | null): GeminiSetup {
  const a = c.activity;
  return {
    setup: {
      model: `models/${c.model}`,
      generationConfig: {
        // Always AUDIO: the native-audio models require it even for a leg that does not speak, whose audio is then dropped (`GeminiClient.ts:490-492`).
        responseModalities: ['AUDIO'],
        ...(c.temperature !== undefined ? { temperature: c.temperature } : {}),
        ...(c.maxOutputTokens !== undefined ? { maxOutputTokens: c.maxOutputTokens } : {}),
        ...(c.voice !== undefined ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } } } } : {}),
        // Under generationConfig, where the SDK nests it (`index.mjs:8675-8680`).
        ...(c.translationTargetCode !== undefined ? { translationConfig: { targetLanguageCode: c.translationTargetCode, echoTargetLanguage: false } } : {}),
      },
      ...(c.instructions !== undefined ? { systemInstruction: { parts: [{ text: c.instructions }] } } : {}),
      inputAudioTranscription: {},
      ...(c.transcribeOnly ? {} : { outputAudioTranscription: {} }),
      realtimeInputConfig: {
        // Per model family (Gemini/AST2 follow-up, ruling 5), where the old client hard-coded `NO_INTERRUPTION` (`GeminiClient.ts:496`).
        activityHandling: c.activityHandling,
        automaticActivityDetection: a.manual
          ? { disabled: true }
          : {
              disabled: false,
              startOfSpeechSensitivity: a.start === 'high' ? 'START_SENSITIVITY_HIGH' : 'START_SENSITIVITY_LOW',
              endOfSpeechSensitivity: a.end === 'high' ? 'END_SENSITIVITY_HIGH' : 'END_SENSITIVITY_LOW',
              silenceDurationMs: a.silenceMs,
              prefixPaddingMs: a.prefixMs,
            },
      },
      // `{}` asks for resumption updates on a fresh session; `transparent` is Vertex-only (`index.mjs:9226-9228`).
      sessionResumption: handle ? { handle } : {},
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

export function audioFrame(pcm: Int16Array): string {
  return JSON.stringify({ realtimeInput: { audio: { data: pcmToBase64(pcm), mimeType: INPUT_MIME } } });
}

/** Valid only while automatic detection is off (`web.d.ts:4-9, 27-32`): manual turns. */
export const ACTIVITY_START = JSON.stringify({ realtimeInput: { activityStart: {} } });
export const ACTIVITY_END = JSON.stringify({ realtimeInput: { activityEnd: {} } });

export function textFrame(text: string): string {
  return JSON.stringify({ realtimeInput: { text } });
}

/** One server frame, as the Developer API sends it — the SDK assigns it untouched (`index.mjs:14761-14783`). */
export interface GeminiServerMessage {
  setupComplete?: LiveServerSetupComplete;
  serverContent?: LiveServerContent;
  toolCall?: unknown;
  toolCallCancellation?: unknown;
  usageMetadata?: UsageMetadata;
  goAway?: LiveServerGoAway;
  sessionResumptionUpdate?: LiveServerSessionResumptionUpdate;
  /**
   * The server's voice activity, a message of its own: `type` as the wire
   * spells it, which the SDK's own `VoiceActivity` renames
   * `voiceActivityType` — so typed here, not taken from the SDK (Gemini
   * hold, choice 12). The 3.x dialogue models send it under both turn
   * modes; the 2.5 model sends none (the owner's probes).
   */
  voiceActivity?: { type?: string; audioOffset?: string };
}

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/**
 * A server frame, decoded at once: text, or the binary frame the server
 * sends, read as an ArrayBuffer — so frames are handled in the order they
 * came, where the SDK's awaited `Blob.text()` let them overtake (survey
 * §1.16.4). Throws when it is not a JSON object.
 */
export function decodeServerMessage(data: unknown): GeminiServerMessage {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  return parsed as GeminiServerMessage;
}

/** Gemini's own documented Live output rate — independent of the contract's `SAMPLE_RATE`, which describes the input the client sends. */
const GEMINI_OUTPUT_RATE = 24000;

/** The rate a pcm mime type names; the Live API's documented 24 000 when it names none (choice 18). */
export function pcmRate(mimeType: string | undefined): number {
  const m = /rate=(\d+)/.exec(mimeType ?? '');
  return m ? Number(m[1]) : GEMINI_OUTPUT_RATE;
}

export type StartFailureCode = 'auth' | 'rate_limit' | 'client' | 'server' | 'network';

/**
 * A close before `setupComplete` as a notice code (choice 12): Google names
 * a bad key and an exhausted quota in words, so the reason decides first,
 * then the code. The codes and reasons the server sends are live-checked.
 */
export function closeFailureCode(code: number, reason: string): StartFailureCode {
  if (/api[ _-]?key/i.test(reason)) return 'auth';
  if (/quota|rate[ _-]?limit|resource[ _]?exhausted/i.test(reason)) return 'rate_limit';
  if (code === 1007 || code === 1008) return 'client';
  if (code === 1011 || code === 1013) return 'server';
  return 'network';
}
