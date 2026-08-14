import { describe, expect, it, vi } from 'vitest';
import { OpenAIWebRTCClient } from './OpenAIWebRTCClient';

/**
 * GA conversation-item regression tests.
 *
 * A live GA session never emits `conversation.item.created` — user and
 * assistant items are announced via `conversation.item.added` (assistant items
 * additionally via `response.output_item.added`, which stays unhandled on
 * purpose so out-of-band responses do not pollute the conversation). The
 * WebRTC client must build its conversation from `conversation.item.added`
 * or the panel stays empty for the whole session.
 */

function makeClient(): { client: OpenAIWebRTCClient; handle: (ev: unknown) => void } {
  const client = new OpenAIWebRTCClient({ apiKey: 'sk-test' });
  const handle = (ev: unknown) => (client as any).handleServerEvent(ev);
  return { client, handle };
}

describe('OpenAIWebRTCClient GA conversation items', () => {
  it('creates items from conversation.item.added and attaches later transcripts', () => {
    const { client, handle } = makeClient();

    handle({
      type: 'conversation.item.added',
      item: { id: 'item_user', role: 'user', type: 'message', status: 'completed' }
    });
    handle({
      type: 'conversation.item.added',
      item: { id: 'item_asst', role: 'assistant', type: 'message', status: 'in_progress' }
    });
    handle({ type: 'response.output_audio_transcript.delta', item_id: 'item_asst', delta: 'Bonjour' });
    handle({ type: 'response.output_audio_transcript.delta', item_id: 'item_asst', delta: ' !' });
    handle({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item_user',
      transcript: 'Hello'
    });

    const items = client.getConversationItems();
    expect(items.map(i => i.id)).toEqual(['item_user', 'item_asst']);
    expect(items[0].role).toBe('user');
    expect(items[0].formatted?.transcript).toBe('Hello');
    expect(items[1].formatted?.transcript).toBe('Bonjour !');
  });

  it('does not duplicate an item announced through both created and added', () => {
    const { client, handle } = makeClient();

    handle({
      type: 'conversation.item.created',
      item: { id: 'item_1', role: 'assistant', type: 'message', status: 'in_progress' }
    });
    handle({
      type: 'conversation.item.added',
      item: { id: 'item_1', role: 'assistant', type: 'message', status: 'in_progress' }
    });

    expect(client.getConversationItems()).toHaveLength(1);
  });
});

describe('OpenAIWebRTCClient.getInputFrequencies', () => {
  it('returns null before a local stream (and its analyser) exists', () => {
    // No session has connected (no getUserMedia call has happened yet), so
    // the bridge's LOCAL analyser has nothing to report.
    const { client } = makeClient();

    expect(client.getInputFrequencies()).toBeNull();
  });

  it('delegates to the bridge LOCAL analyser, not the remote/output one', () => {
    // Pins the IClient contract added for the mic-waveform fallback:
    // getInputFrequencies() must forward to the bridge's getLocalFrequencies
    // (mic input), never to getFrequencies (remote/AI output) — the spy
    // proves forwarding rather than both coincidentally returning null.
    const { client } = makeClient();
    const bridge = (client as any).audioBridge;
    const localSpy = vi.spyOn(bridge, 'getLocalFrequencies')
      .mockReturnValue({ values: new Float32Array([0.5]) });
    const remoteSpy = vi.spyOn(bridge, 'getFrequencies');

    const result = client.getInputFrequencies();

    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(remoteSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ values: new Float32Array([0.5]) });
  });
});
