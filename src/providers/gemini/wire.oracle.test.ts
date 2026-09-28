/**
 * The wire against the SDK's own converter (ruling 7; choice 10): for each
 * shape of config, the setup frame the old client's `live.connect` sent —
 * the SDK's `liveConnectConfigToMldev$1` over the `LiveConnectConfig` the
 * old client built (`GeminiClient.ts:490-574`) — equals `setupFrame`, and
 * its URL `liveUrl`. The SDK's browser build opens a global `WebSocket`,
 * stubbed here with `FakeSocket`: it connects nowhere (ruling 14). The one
 * value import of `@google/genai` outside the old client; the deletion
 * plan decides its fate.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ActivityHandling, EndSensitivity, GoogleGenAI, Modality, StartSensitivity, type LiveConnectConfig } from '@google/genai/web';
import { flush } from '../../lib/contract/testing/drive';
import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import type { GeminiConfig } from './config';
import { AUTO_CTX, BARGE_IN, configFor, DIALOGUE, KEY, TRANSLATE } from './testing';
import { ACTIVITY_END, ACTIVITY_START, audioFrame, INPUT_MIME, liveUrl, pcmToBase64, setupFrame, textFrame } from './wire';

/** The old client's `LiveConnectConfig` for this `C`, enums and all (`GeminiClient.ts:490-574`), its activity handling now the config's (Gemini/AST2 follow-up, ruling 5). */
function oldLiveConfig(c: GeminiConfig, handle: string | null): LiveConnectConfig {
  const a = c.activity;
  return {
    responseModalities: [Modality.AUDIO],
    temperature: c.temperature,
    maxOutputTokens: c.maxOutputTokens,
    systemInstruction: c.instructions ? { parts: [{ text: c.instructions }] } : undefined,
    translationConfig: c.translationTargetCode ? { targetLanguageCode: c.translationTargetCode, echoTargetLanguage: false } : undefined,
    speechConfig: c.voice ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } } } : undefined,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      activityHandling: c.activityHandling === 'START_OF_ACTIVITY_INTERRUPTS' ? ActivityHandling.START_OF_ACTIVITY_INTERRUPTS : ActivityHandling.NO_INTERRUPTION,
      automaticActivityDetection: a.manual
        ? { disabled: true }
        : {
            disabled: false,
            startOfSpeechSensitivity: a.start === 'high' ? StartSensitivity.START_SENSITIVITY_HIGH : StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: a.end === 'high' ? EndSensitivity.END_SENSITIVITY_HIGH : EndSensitivity.END_SENSITIVITY_LOW,
            silenceDurationMs: a.silenceMs,
            prefixPaddingMs: a.prefixMs,
          },
    },
    sessionResumption: { handle: handle ?? undefined },
    contextWindowCompression: { slidingWindow: {} },
  };
}

/** What the SDK sends for this config: the URL it dials and its one setup frame. */
async function sdkSends(c: GeminiConfig, handle: string | null): Promise<{ url: string; frame: unknown }> {
  const opened: FakeSocket[] = [];
  vi.stubGlobal('WebSocket', class extends FakeSocket {
    constructor(url: string) {
      super(url, undefined);
      opened.push(this);
    }
  });
  const connecting = new GoogleGenAI({ apiKey: KEY.apiKey }).live.connect({ model: c.model, config: oldLiveConfig(c, handle), callbacks: { onmessage: () => {} } });
  await flush();
  const socket = opened[0];
  socket.open();
  await flush();
  const frame: unknown = JSON.parse(socket.sent[0] as string);
  // Let the SDK finish — setup complete, then closed — so nothing is left pending.
  socket.receive(JSON.stringify({ setupComplete: {} }));
  (await connecting).close();
  return { url: socket.url, frame };
}

afterEach(() => vi.unstubAllGlobals());

describe("the wire against the SDK's own converter", () => {
  const cases: Array<[string, () => GeminiConfig, string | null]> = [
    ['a dialogue model, auto, speaking', () => configFor(DIALOGUE), null],
    ['a dialogue model with max tokens, resuming', () => configFor(DIALOGUE, AUTO_CTX, { maxTokens: 2048 }), 'handle-1'],
    ['a dialogue model, manual, silent, high sensitivities', () => configFor(DIALOGUE, { ...AUTO_CTX, speech: false, turns: 'manual' }, { vadStartSensitivity: 'high' }), null],
    ['a dialogue model, auto, high sensitivities', () => configFor(DIALOGUE, AUTO_CTX, { vadStartSensitivity: 'high', vadEndSensitivity: 'low', vadSilenceDurationMs: 900 }), null],
    ['a 3.x dialogue model, barging in', () => configFor(BARGE_IN), null],
    ['a 3.x dialogue model, manual, barging in', () => configFor(BARGE_IN, { ...AUTO_CTX, turns: 'manual' }), null],
    ['Live Translate', () => configFor(TRANSLATE), null],
    ["Live Translate for the participant, with no prompt", () => configFor(TRANSLATE, { direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' }, { useTemplateMode: false, systemInstructions: ' ' }), null],
  ];

  it.each(cases)('%s', async (_name, make, handle) => {
    const c = make();
    const sdk = await sdkSends(c, handle);
    expect(sdk.frame).toEqual(setupFrame(c, handle));
    // The SDK doubles the slash before `ws/` (its base URL keeps its own, `index.mjs:13793-13797, 14884`); the endpoint is the same (choice 11).
    expect(sdk.url.replace('.com//ws/', '.com/ws/')).toBe(liveUrl(KEY.apiKey));
  });

  it('sends the SDK its own realtime-input frames unchanged: audio, activity markers and typed text', async () => {
    const opened: FakeSocket[] = [];
    vi.stubGlobal('WebSocket', class extends FakeSocket {
      constructor(url: string) {
        super(url, undefined);
        opened.push(this);
      }
    });
    const c = configFor(DIALOGUE);
    const connecting = new GoogleGenAI({ apiKey: KEY.apiKey }).live.connect({ model: c.model, config: oldLiveConfig(c, null), callbacks: { onmessage: () => {} } });
    await flush();
    const socket = opened[0];
    socket.open();
    await flush();
    socket.receive(JSON.stringify({ setupComplete: {} }));
    const session = await connecting;
    const pcm = new Int16Array([1, 2, 3, 4]);
    session.sendRealtimeInput({ audio: { mimeType: INPUT_MIME, data: pcmToBase64(pcm) } });
    session.sendRealtimeInput({ activityStart: {} });
    session.sendRealtimeInput({ activityEnd: {} });
    session.sendRealtimeInput({ text: 'hello' });
    session.close();
    // socket.sent[0] is the setup frame; the four realtime-input sends follow it, in order.
    expect(socket.sent.slice(1)).toEqual([audioFrame(pcm), ACTIVITY_START, ACTIVITY_END, textFrame('hello')]);
  });
});
