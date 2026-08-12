import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useLogStore from './logStore';

// Characterization tests for how addRealtimeEvent groups consecutive events.
//
// These pin the per-client "find the last log for this client" behaviour that
// grouping depends on, including the case where that log has already been
// flushed out of `pendingLogs` into `logs`. The lookup runs on every realtime
// event, so it is on the hot path for high-rate providers.
describe('logStore — per-client event grouping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLogStore.getState().clearLogs();
  });

  afterEach(() => {
    useLogStore.getState().clearLogs();
    vi.useRealTimers();
  });

  const append = (clientId: 'speaker' | 'participant', seq = 0) =>
    useLogStore.getState().addRealtimeEvent(
      { type: 'input_audio_buffer.append', audio: `chunk-${seq}` } as any,
      'client',
      'input_audio_buffer.append',
      clientId
    );

  const entriesFor = (clientId: string) =>
    useLogStore.getState().allLogs.filter(l => l.clientId === clientId);

  it('collapses consecutive appends from one client into a single entry', () => {
    append('speaker', 0);
    append('speaker', 1);
    append('speaker', 2);

    const speaker = entriesFor('speaker');
    expect(speaker).toHaveLength(1);
    expect(speaker[0].events).toHaveLength(3);
    expect(speaker[0].groupingKey).toBe('input_audio_buffer');
  });

  it('keeps interleaved clients in separate groups', () => {
    append('speaker', 0);
    append('participant', 0);
    append('speaker', 1);
    append('participant', 1);

    // Each client collapses into its own entry despite the interleaving.
    expect(entriesFor('speaker')).toHaveLength(1);
    expect(entriesFor('participant')).toHaveLength(1);
    expect(entriesFor('speaker')[0].events).toHaveLength(2);
    expect(entriesFor('participant')[0].events).toHaveLength(2);
  });

  it('groups with the client\'s last log even after it flushed into logs', () => {
    append('speaker', 0);
    useLogStore.getState().flushPendingLogs();
    expect(useLogStore.getState().logs).toHaveLength(1);
    expect(useLogStore.getState().pendingLogs).toHaveLength(0);

    append('speaker', 1);

    // Still one entry — the lookup must reach into `logs`, not just pendingLogs.
    const speaker = entriesFor('speaker');
    expect(speaker).toHaveLength(1);
    expect(speaker[0].events).toHaveLength(2);
  });

  it('starts a new entry when the event type changes', () => {
    append('speaker', 0);
    useLogStore.getState().addRealtimeEvent(
      { type: 'response.created' } as any,
      'server',
      'response.created',
      'speaker'
    );
    append('speaker', 1);

    // The differing event breaks the run, so the trailing append cannot rejoin
    // the original group.
    expect(entriesFor('speaker')).toHaveLength(3);
  });
});
