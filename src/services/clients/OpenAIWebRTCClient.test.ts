import { describe, expect, it } from 'vitest';
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
