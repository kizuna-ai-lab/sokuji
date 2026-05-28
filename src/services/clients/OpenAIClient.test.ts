import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock i18n (transitively imported by OpenAIClient via textUtils / locales).
vi.mock('../../locales', () => ({
  default: { t: (key: string) => key }
}));

// Mock openai-realtime-api with a minimal stub. We only test the
// `convertToConversationItem` mapping logic, not the full SDK integration.
// The real SDK includes network handshaking, event protocols, and session
// state machines we don't need for this unit test.
vi.mock('openai-realtime-api', () => {
  class RealtimeClient {
    constructor(_opts: unknown) {}
    on() {}
    off() {}
  }
  return { RealtimeClient };
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
