import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock i18n (transitively imported by OpenAIClient via textUtils / locales).
vi.mock('../../locales', () => ({
  default: { t: (key: string) => key }
}));

// Mock openai-realtime-api with a minimal stub. We only test the adapter logic
// in OpenAIClient, not the full SDK integration -- the real SDK includes
// network handshaking, event protocols, and session state machines we don't
// need for these unit tests.
//
// `appendInputAudio` deliberately reproduces the real SDK's accumulation
// (dist/index.js:998 concatenates every chunk onto `inputAudioBuffer`), so the
// tests below can assert that our default path does NOT go through it.
vi.mock('openai-realtime-api', () => {
  class RealtimeClient {
    realtime = { send: vi.fn() };
    inputAudioBuffer = new Int16Array(0);
    turnDetectionType: string | undefined = 'server_vad';
    createResponse = vi.fn();
    reset = vi.fn(() => { this.inputAudioBuffer = new Int16Array(0); });
    appendInputAudio = vi.fn((chunk: Int16Array) => {
      const merged = new Int16Array(this.inputAudioBuffer.length + chunk.length);
      merged.set(this.inputAudioBuffer, 0);
      merged.set(chunk, this.inputAudioBuffer.length);
      this.inputAudioBuffer = merged;
    });
    constructor(_opts: unknown) {}
    on() {}
    off() {}
    getTurnDetectionType() { return this.turnDetectionType; }
  }
  return { RealtimeClient, arrayBufferToBase64: () => 'BASE64' };
});

const { OpenAIClient } = await import('./OpenAIClient');

describe('OpenAIClient — keepReplayAudio gating in convertToConversationItem', () => {
  let client: any;

  beforeEach(() => {
    client = new OpenAIClient('test-api-key');
  });

  function makeFormattedItem(audio?: Int16Array, file?: Blob): any {
    return {
      id: 'item-1',
      role: 'assistant',
      type: 'message',
      status: 'completed',
      formatted: {
        text: 'hello',
        transcript: 'hello',
        audio,
        file,
      },
      content: [],
    };
  }

  it('keeps formatted.audio and formatted.file when keepReplayAudio is true', () => {
    client.keepReplayAudio = true;
    const audio = new Int16Array([1, 2, 3]);
    const file = new Blob([new Uint8Array([0, 1, 2])], { type: 'audio/wav' });
    const input = makeFormattedItem(audio, file);

    const result = client.convertToConversationItem(input);

    expect(result.formatted?.audio).toBe(audio);
    expect(result.formatted?.file).toBe(file);
  });

  it('strips formatted.audio and formatted.file when keepReplayAudio is false', () => {
    // Default per spec — replay storage off, no per-item audio retained.
    client.keepReplayAudio = false;
    const audio = new Int16Array([1, 2, 3]);
    const file = new Blob([new Uint8Array([0, 1, 2])], { type: 'audio/wav' });
    const input = makeFormattedItem(audio, file);

    const result = client.convertToConversationItem(input);

    // Text fields still flow through — only the heavy replay fields drop.
    // (text and transcript are what the UI shows; audio/file are the
    // memory-heavy replay payload that only the inline ▶ button reads.)
    expect(result.formatted?.text).toBe('hello');
    expect(result.formatted?.transcript).toBe('hello');
    expect(result.formatted?.audio).toBeUndefined();
    expect(result.formatted?.file).toBeUndefined();
  });
});

// Regression tests for issue #406.
//
// RealtimeClient.appendInputAudio() concatenates every chunk onto
// `client.inputAudioBuffer`, and RealtimeClient.createResponse() only ever
// empties that buffer when turn detection is OFF. Under server/semantic VAD the
// buffer therefore grew for the entire session and every append re-copied all of
// it on the main thread, so append cost climbed linearly with session length
// until it starved audio delivery and message handling.
describe('OpenAIClient — input audio buffer retention (issue #406)', () => {
  let client: any;
  let sdk: any;

  beforeEach(() => {
    client = new OpenAIClient('test-api-key');
    sdk = client.client;
  });

  const chunk = () => new Int16Array(4096);

  describe('with keepReplayAudio off (the default)', () => {
    beforeEach(() => {
      client.keepReplayAudio = false;
    });

    it('sends each chunk on the wire without accumulating it', () => {
      for (let i = 0; i < 50; i++) client.appendInputAudio(chunk());

      expect(sdk.realtime.send).toHaveBeenCalledTimes(50);
      expect(sdk.realtime.send).toHaveBeenCalledWith('input_audio_buffer.append', { audio: 'BASE64' });
      // The whole point: nothing is retained across appends.
      expect(sdk.appendInputAudio).not.toHaveBeenCalled();
      expect(sdk.inputAudioBuffer.length).toBe(0);
    });

    it('ignores empty chunks', () => {
      client.appendInputAudio(new Int16Array(0));

      expect(sdk.realtime.send).not.toHaveBeenCalled();
    });

    it('still commits the buffer before response.create when turn detection is off (PTT)', () => {
      sdk.turnDetectionType = undefined;
      client.appendInputAudio(chunk());
      sdk.realtime.send.mockClear();

      client.createResponse();

      // Bypassing the SDK must not lose the commit that PTT depends on.
      expect(sdk.realtime.send.mock.calls.map((c: any[]) => c[0]))
        .toEqual(['input_audio_buffer.commit', 'response.create']);
    });

    it('does not commit twice when no new audio arrived since the last commit', () => {
      sdk.turnDetectionType = undefined;
      client.appendInputAudio(chunk());
      client.createResponse();
      sdk.realtime.send.mockClear();

      client.createResponse();

      // An empty commit is rejected by the server with "buffer too small".
      expect(sdk.realtime.send.mock.calls.map((c: any[]) => c[0])).toEqual(['response.create']);
    });

    it('does not commit under server VAD, where the server owns turn boundaries', () => {
      sdk.turnDetectionType = 'server_vad';
      client.appendInputAudio(chunk());
      sdk.realtime.send.mockClear();

      client.createResponse();

      expect(sdk.realtime.send.mock.calls.map((c: any[]) => c[0])).toEqual(['response.create']);
    });

    it('clears pending audio on reset so a new session cannot inherit a stale commit', () => {
      sdk.turnDetectionType = undefined;
      client.appendInputAudio(chunk());

      client.reset();
      sdk.realtime.send.mockClear();
      client.createResponse();

      expect(sdk.realtime.send.mock.calls.map((c: any[]) => c[0])).toEqual(['response.create']);
    });
  });

  describe('with keepReplayAudio on', () => {
    beforeEach(() => {
      client.keepReplayAudio = true;
    });

    it('keeps using the SDK buffer, which is what populates user replay audio', () => {
      // Zero behaviour change for users who explicitly opted into replay audio:
      // the SDK's speech_stopped handler slices this buffer into
      // item.formatted.audio, and nothing else can produce it on this provider.
      client.appendInputAudio(chunk());
      client.appendInputAudio(chunk());

      expect(sdk.appendInputAudio).toHaveBeenCalledTimes(2);
      expect(sdk.inputAudioBuffer.length).toBe(8192);
      expect(sdk.realtime.send).not.toHaveBeenCalled();
    });

    it('delegates createResponse to the SDK so it can commit and queue the audio', () => {
      client.appendInputAudio(chunk());

      client.createResponse();

      expect(sdk.createResponse).toHaveBeenCalledTimes(1);
    });
  });
});
