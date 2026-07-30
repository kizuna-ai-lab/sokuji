import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RealtimeEvent } from '../../stores/logStore';

vi.mock('../../locales', () => ({
  default: { t: (key: string) => key }
}));

// PalabraAIClient calls setLogLevel() at module load and only touches the rest of
// livekit-client once a room exists, so a surface-level stub is enough here.
vi.mock('livekit-client', () => ({
  setLogLevel: vi.fn(),
  Room: class {},
  RoomEvent: {
    TrackSubscribed: 'trackSubscribed',
    DataReceived: 'dataReceived',
    Connected: 'connected',
    Disconnected: 'disconnected',
  },
  TrackPublication: class {},
  RemoteParticipant: class {},
  RemoteTrack: class {},
  RemoteAudioTrack: class {},
  LocalAudioTrack: class {},
}));

const { PalabraAIClient } = await import('./PalabraAIClient');

/**
 * Feed a JSON payload through the room's data-message path, exactly as the
 * RoomEvent.DataReceived handler registered in connectToRoom() would. The
 * handler is private, so we reach it directly rather than standing up a full
 * WebRTC room just to classify one message.
 */
function receiveDataMessage(client: unknown, message: unknown): void {
  const payload = new TextEncoder().encode(JSON.stringify(message));
  (client as any).handleDataReceived(payload);
}

describe('PalabraAIClient data message handling', () => {
  let client: InstanceType<typeof PalabraAIClient>;
  let events: RealtimeEvent[];

  beforeEach(() => {
    client = new PalabraAIClient('test-id', 'test-secret');
    events = [];
    client.setEventHandlers({
      onRealtimeEvent: (event) => { events.push(event); },
    });
  });

  const errorEvents = () => events.filter((e) => e.event.type === 'error');

  it('ignores an empty queue status map instead of reporting it as an error', () => {
    // Palabra emits the queue status roughly once a second. Before any
    // translation is queued the map is empty, and an empty map is still a queue
    // status message — not something to surface to the user as an error.
    receiveDataMessage(client, {});

    expect(errorEvents()).toEqual([]);
  });

  it('reports an empty array as an error rather than mistaking it for a queue status map', () => {
    // Object.keys([]) is also empty, so the empty-map shortcut must not swallow a
    // JSON array — the queue status is always a map.
    receiveDataMessage(client, []);

    expect(errorEvents()).toHaveLength(1);
  });

  it('ignores a populated queue status map', () => {
    receiveDataMessage(client, { es: { current_queue_level_ms: 0, max_queue_level_ms: 24000 } });

    expect(errorEvents()).toEqual([]);
  });

  it('reports a genuinely unrecognized message as an error', () => {
    receiveDataMessage(client, { message_type: 'something_new', data: { foo: 1 } });

    expect(errorEvents()).toHaveLength(1);
    expect(errorEvents()[0].event.data).toMatchObject({ message_type: 'something_new' });
  });

  it('routes a transcription message to the conversation instead of the error path', () => {
    const updated: string[] = [];
    client.setEventHandlers({
      onRealtimeEvent: (event) => { events.push(event); },
      onConversationUpdated: ({ item }) => {
        const text = item.formatted?.transcript ?? item.formatted?.text ?? '';
        if (text) updated.push(text);
      },
    });

    receiveDataMessage(client, {
      message_type: 'validated_transcription',
      data: { transcription: { transcription_id: 'abc123', language: 'en', text: 'Hello there' } },
    });

    expect(errorEvents()).toEqual([]);
    expect(updated).toContain('Hello there');
  });
});
