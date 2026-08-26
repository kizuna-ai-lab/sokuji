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

describe('logStore — channel filing', () => {
  beforeEach(() => useLogStore.getState().clearLogs());
  afterEach(() => useLogStore.getState().clearLogs());

  // `clientId || 'speaker'` made a global entry impossible to express, so every
  // non-session failure (settings, auth, devices) filed under the "Me" tab, and
  // MainPanel's participant connect-failure row (MainPanel.tsx:2468) filed under
  // the wrong tab entirely. LogsPanel.tsx:125 already shows undefined under both
  // tabs; nothing could produce one.
  it('keeps an omitted channel undefined so both tabs show the entry', () => {
    useLogStore.getState().addLog('settings failed to load', 'error');
    expect(useLogStore.getState().allLogs[0].clientId).toBeUndefined();
  });

  it('keeps an omitted channel undefined for realtime events too', () => {
    useLogStore.getState().addRealtimeEvent(
      { type: 'session.init_error', data: {} } as any, 'client', 'session.init_error'
    );
    expect(useLogStore.getState().allLogs[0].clientId).toBeUndefined();
  });

  it('still files an explicit channel', () => {
    useLogStore.getState().addLog('participant leg died', 'error', 'participant');
    expect(useLogStore.getState().allLogs[0].clientId).toBe('participant');
  });
});

describe('logStore — redaction at the sink', () => {
  beforeEach(() => useLogStore.getState().clearLogs());
  afterEach(() => useLogStore.getState().clearLogs());

  // Sink-side, not call-site: this also covers the legacy addLog callers and any
  // future bypass. Panel text is copy-pasted into bug reports.
  it('redacts credentials in plain entries', () => {
    useLogStore.getState().addLog('auth failed for sk-abcdef1234567', 'error');
    expect(useLogStore.getState().allLogs[0].message).toBe('auth failed for [REDACTED]');
  });
});

describe('logStore — event severity', () => {
  beforeEach(() => useLogStore.getState().clearLogs());
  afterEach(() => useLogStore.getState().clearLogs());

  const typeOf = (eventType: string) => {
    useLogStore.getState().clearLogs();
    useLogStore.getState().addRealtimeEvent({ type: eventType, data: {} } as any, 'client', eventType);
    return useLogStore.getState().allLogs[0].type;
  };

  // Every realtime row was stamped 'info', so a session failure looked exactly
  // like a transcript delta and the .error/.warning styles in LogsPanel.scss
  // (:121-145) were unreachable for events.
  it('marks failure events as errors', () => {
    expect(typeOf('session.error')).toBe('error');
    expect(typeOf('session.init_error')).toBe('error');
    expect(typeOf('local.pipeline.error')).toBe('error');
    expect(typeOf('conversation.item.input_audio_transcription.failed')).toBe('error');
    expect(typeOf('error')).toBe('error');
  });

  it('marks warning events as warnings', () => {
    expect(typeOf('participant.warning')).toBe('warning');
  });

  it('leaves ordinary traffic as info', () => {
    expect(typeOf('response.created')).toBe('info');
    expect(typeOf('input_audio_buffer.append')).toBe('info');
    // Substring, not suffix: a normal event whose name merely contains "error".
    expect(typeOf('session.error_recovered')).toBe('info');
  });
});

describe('logStore — bounded memory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLogStore.getState().clearLogs();
  });
  afterEach(() => {
    useLogStore.getState().clearLogs();
    vi.useRealTimers();
  });

  // The batch timer used to be a DEBOUNCE — every write cleared the pending
  // timeout and set a new one — so any stream spaced under BATCH_DELAY_MS
  // (audio deltas in a live session) starved flushPendingLogs forever. A cap
  // enforced in flush would then never run. It has to be a throttle.
  // The invariant is on `logs`, which flush caps exactly. `allLogs` is
  // `logs` + the unflushed batch, so it peaks at 2000 + one batch (~15 entries
  // at this rate); the headroom below is generous but still orders of magnitude
  // below the 10 000 the debounce version reached.
  it('stays bounded under a write stream faster than the batch delay', () => {
    for (let i = 0; i < 10_000; i++) {
      useLogStore.getState().addLog(`entry ${i}`, 'error', 'speaker');
      vi.advanceTimersByTime(10);
      expect(useLogStore.getState().logs.length).toBeLessThanOrEqual(2000);
      expect(useLogStore.getState().allLogs.length).toBeLessThanOrEqual(2100);
    }
  });

  it('keeps the newest entries when it trims', () => {
    for (let i = 0; i < 2500; i++) {
      useLogStore.getState().addLog(`entry ${i}`, 'error', 'speaker');
      vi.advanceTimersByTime(10);
    }
    const messages = useLogStore.getState().allLogs.map(l => l.message);
    expect(messages[messages.length - 1]).toBe('entry 2499');
    expect(messages).not.toContain('entry 0');
  });

  // LogsPanel keys rows by id rather than by array index: with trimming, indices
  // shift under an expanded <Event>, migrating its open/JSON state onto a
  // different entry.
  it('assigns strictly increasing ids that survive a trim', () => {
    for (let i = 0; i < 2500; i++) {
      useLogStore.getState().addLog(`entry ${i}`, 'error', 'speaker');
      vi.advanceTimersByTime(10);
    }
    const ids = useLogStore.getState().allLogs.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1]);
  });
});
