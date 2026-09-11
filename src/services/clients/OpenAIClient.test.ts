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
    // Reproduces the real SDK (dist/index.js:976-988): the item goes out over
    // `realtime.send` — so it throws on a dead socket exactly like every other
    // send — and a response is requested afterwards.
    sendUserMessageContent = vi.fn((content: unknown[]) => {
      if (content.length) {
        this.realtime.send('conversation.item.create', {
          item: { type: 'message', role: 'user', content }
        });
      }
      this.createResponse();
    });
    // Mirrors the SDK's RealtimeEventHandler contract: an array of handlers per
    // event, `on` appends, `off(event, cb)` removes only that callback.
    // OpenAIClient registers two 'realtime.event' handlers - the forwarder and
    // waitForSessionWithErrorHandling's temporary errorHandler - so a single
    // slot would silently drop one. (The SDK throws when `cb` is missing; that
    // is its own defect, and deliberately not modelled here.)
    handlers: Record<string, Array<(payload: any) => void>> = {};
    constructor(_opts: unknown) {}
    on(event: string, handler: (payload: any) => void) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event].push(handler);
    }
    off(event: string, handler?: (payload: any) => void) {
      if (!handler) { delete this.handlers[event]; return; }
      const list = this.handlers[event];
      if (!list) return;
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    }
    emit(event: string, payload: any) {
      for (const h of [...(this.handlers[event] || [])]) h(payload);
    }
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

// RealtimeAPI.send() throws `RealtimeAPI is not connected` once the socket is
// down (dist/index.js:339). The beta SDK never guards its own sends, so these
// throws used to escape into the per-chunk audio callback in MainPanel, which
// has no try/catch around it. The GA client doesn't have this problem: the
// official `openai` SDK catches inside send() and routes to _onError. This
// brings the beta client to the same effective behaviour.
describe('OpenAIClient — realtime send failure handling', () => {
  let client: any;
  let sdk: any;
  let onError: any;
  let onRealtimeEvent: any;

  beforeEach(() => {
    client = new OpenAIClient('test-api-key');
    sdk = client.client;
    onError = vi.fn();
    onRealtimeEvent = vi.fn();
    client.setEventHandlers({ onError, onRealtimeEvent });
    client.keepReplayAudio = false;
  });

  const chunk = () => new Int16Array(4096);
  const failEverySend = () => sdk.realtime.send.mockImplementation(() => {
    throw new Error('RealtimeAPI is not connected');
  });
  const sentTypes = () => sdk.realtime.send.mock.calls.map((c: any[]) => c[0]);
  const reportedOps = () => onRealtimeEvent.mock.calls
    .filter((c: any[]) => c[0].event.type === 'session.error')
    .map((c: any[]) => c[0].event.data.operation);

  it('does not let an append failure escape into the audio callback', () => {
    failEverySend();

    expect(() => client.appendInputAudio(chunk())).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reportedOps()).toEqual(['input_audio_buffer.append']);
  });

  it('reports a sustained append failure once, not once per chunk', () => {
    failEverySend();

    for (let i = 0; i < 50; i++) client.appendInputAudio(chunk());

    // onError appends an item to the conversation list (MainPanel), and this
    // path runs ~6x/second at 24kHz, so per-chunk reporting would bury the
    // transcript under hundreds of duplicate error entries.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reportedOps()).toEqual(['input_audio_buffer.append']);
  });

  it('reports again after the socket recovers and fails a second time', () => {
    failEverySend();
    client.appendInputAudio(chunk());

    sdk.realtime.send.mockImplementation(() => {});
    client.appendInputAudio(chunk());

    failEverySend();
    client.appendInputAudio(chunk());

    // A new outage is new information, so the latch must clear on success.
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('aborts response creation when the PTT commit fails', () => {
    sdk.turnDetectionType = undefined;
    client.appendInputAudio(chunk());
    sdk.realtime.send.mockClear();
    failEverySend();

    expect(() => client.createResponse()).not.toThrow();

    // Creating a response over an uncommitted buffer would answer the wrong
    // audio, so the commit failure has to stop the turn.
    expect(sentTypes()).toEqual(['input_audio_buffer.commit']);
    expect(reportedOps()).toEqual(['input_audio_buffer.commit']);
  });

  it('reports a response.create failure without throwing', () => {
    sdk.realtime.send.mockImplementation((type: string) => {
      if (type === 'response.create') throw new Error('RealtimeAPI is not connected');
    });

    expect(() => client.createResponse()).not.toThrow();
    expect(reportedOps()).toEqual(['response.create']);
  });

  // #544: the one send path that had no guard. The text box is a speaker-channel
  // control, so this only fires when the speaker socket dies under a live
  // session — but it threw straight out of the React event handler, past
  // MainPanel's catch and into the console as an unhandled rejection shape the
  // user could do nothing with.
  it('reports a text-input failure without throwing', () => {
    failEverySend();

    expect(() => client.appendInputText('hello')).not.toThrow();
    expect(reportedOps()).toEqual(['conversation.item.create']);
  });

  it('does not request a response when the text item never went out', () => {
    failEverySend();

    client.appendInputText('hello');

    // sendUserMessageContent calls createResponse() after the item; a response
    // over an item the server never received would answer the previous turn.
    expect(sdk.createResponse).not.toHaveBeenCalled();
  });

  it('catches failures on the keepReplayAudio path too', () => {
    client.keepReplayAudio = true;
    sdk.appendInputAudio.mockImplementation(() => {
      throw new Error('RealtimeAPI is not connected');
    });

    expect(() => client.appendInputAudio(chunk())).not.toThrow();
    expect(reportedOps()).toEqual(['input_audio_buffer.append']);
  });
});

// The mirror image of #406, on the output side. The SDK's RealtimeConversation
// keeps every item for the whole session -- `items` and `itemLookup` are only
// emptied by clear(), which we call at teardown -- and its
// "response.audio.delta" handler merges each chunk of translated speech onto
// `item.formatted.audio` (dist/index.js:640). convertToConversationItem already
// drops that field from the copy handed to the UI, but the SDK's own copy stayed
// reachable, so an hours-long session retained every second of audio it had ever
// played. Issue #531.
describe('OpenAIClient — output audio retention in the SDK conversation (#531)', () => {
  let client: any;
  let sdk: any;

  beforeEach(() => {
    client = new OpenAIClient('test-api-key');
    sdk = client.client;
    client.setEventHandlers({ onConversationUpdated: () => {} });
  });

  /** An SDK item shaped like the one `conversation.updated` carries. */
  const sdkItem = (samples = 24000) => ({
    id: 'item_1',
    role: 'assistant',
    type: 'message',
    status: 'in_progress',
    formatted: { text: '', transcript: 'hello', audio: new Int16Array(samples) },
    content: [],
  });

  it('releases the SDK copy of the audio when keepReplayAudio is off', () => {
    client.keepReplayAudio = false;
    const item = sdkItem();

    sdk.emit('conversation.updated', { item, delta: { audio: new Int16Array(480) } });

    // Empty, not undefined: the SDK merges the next delta onto this field via
    // mergeInt16Arrays (which throws on anything but an Int16Array) and
    // "conversation.item.truncated" slices it.
    expect(item.formatted.audio).toBeInstanceOf(Int16Array);
    expect(item.formatted.audio.length).toBe(0);
  });

  it('does not retain audio across a run of deltas', () => {
    client.keepReplayAudio = false;
    const item = sdkItem(0);

    // Stand in for the SDK's own delta handler: merge, then hand us the item.
    for (let i = 0; i < 100; i++) {
      const merged = new Int16Array(item.formatted.audio.length + 480);
      merged.set(item.formatted.audio, 0);
      item.formatted.audio = merged;
      sdk.emit('conversation.updated', { item, delta: { audio: new Int16Array(480) } });
    }

    // Without the fix this is 48000 samples and still climbing.
    expect(item.formatted.audio.length).toBe(0);
  });

  it('leaves the audio alone when the user opted into replay', () => {
    client.keepReplayAudio = true;
    const item = sdkItem();

    sdk.emit('conversation.updated', { item, delta: { audio: new Int16Array(480) } });

    expect(item.formatted.audio.length).toBe(24000);
  });

  it('tolerates an item with no formatted block', () => {
    client.keepReplayAudio = false;
    const item: any = { id: 'item_2', role: 'user', type: 'message', content: [] };

    expect(() => sdk.emit('conversation.updated', { item, delta: undefined })).not.toThrow();
  });
});
