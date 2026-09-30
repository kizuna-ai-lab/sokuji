import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useLogStore, { MAX_EVENTS_PER_GROUP } from './logStore';

// These tests assert what reaches the log store, which records nothing unless
// diagnostic logs are switched on (they are off by default in the app).
beforeEach(() => {
  useLogStore.getState().setEnabled(true);
});

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

  // A session nobody speaks in sends nothing but mic appends, and they all
  // share one groupingKey, so they land in ONE entry for as long as the silence
  // lasts. Uncapped, that entry grew for the whole session and every append
  // copied its entire history (#531).
  it('caps the events one group keeps and still counts all of them', () => {
    const total = MAX_EVENTS_PER_GROUP + 50;
    for (let i = 0; i < total; i++) append('speaker', i);

    const speaker = entriesFor('speaker');
    expect(speaker).toHaveLength(1);
    const events = speaker[0].events!;
    expect(events).toHaveLength(MAX_EVENTS_PER_GROUP);
    expect(speaker[0].groupCount).toBe(total);
    // The newest are kept; the oldest are the ones dropped.
    expect((events[events.length - 1] as any).audio).toBe(`chunk-${total - 1}`);
    expect((events[0] as any).audio).toBe('chunk-50');
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

  it("groups each of Gemini's renamed frames: consecutive frames of one type in one entry (Stage 2 Gemini, ruling 12)", () => {
    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
    add('server_content.model_turn');
    add('server_content.model_turn');
    add('server_content.model_turn');
    let speaker = entriesFor('speaker');
    expect(speaker).toHaveLength(1);
    expect(speaker[0].groupingKey).toBe('gemini_model_turn');
    expect(speaker[0].events).toHaveLength(3);

    // Another type starts its own entry: the store merges only consecutive events of the same type (`logStore.ts:525-531`).
    add('server_content.output_transcription');
    add('server_content.output_transcription');
    add('server_content.model_turn');
    speaker = entriesFor('speaker');
    expect(speaker.map((e) => [e.groupingKey, e.events?.length])).toEqual([
      ['gemini_model_turn', 3],
      ['gemini_output_transcription', 2],
      ['gemini_model_turn', 1],
    ]);

    const keys: Array<[string, string]> = [
      ['server_content.input_transcription', 'gemini_input_transcription'],
      ['server_content.turn_complete', 'gemini_turn_complete'],
      ['server_content.generation_complete', 'gemini_generation_complete'],
      ['server_content.interrupted', 'gemini_interrupted'],
      ['server.usage_metadata', 'gemini_usage_metadata'],
    ];
    for (const [type, key] of keys) {
      add(type);
      add(type);
      speaker = entriesFor('speaker');
      expect(speaker[speaker.length - 1].groupingKey, type).toBe(key);
      expect(speaker[speaker.length - 1].events, type).toHaveLength(2);
    }
  });

  it("groups Doubao AST 2.0's renamed frames under the old client's keys (Stage 2 Volcengine AST2, choice 9)", () => {
    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
    add('subtitle.source');
    add('subtitle.source');
    add('subtitle.source');
    let speaker = entriesFor('speaker');
    expect(speaker).toHaveLength(1);
    expect(speaker[0].groupingKey).toBe('volcengine_source_subtitle');
    expect(speaker[0].events).toHaveLength(3);

    // A group holds one frame type (the merge compares `eventType` too): each
    // name keeps its old client's key, but three of them share a key
    // ('volcengine_tts') — adding each type twice and checking the group's own
    // event count is what would catch a grouping that merged them regardless
    // of type; checking only the newest entry's groupingKey would not.
    const keys: Array<[string, string]> = [
      ['subtitle.translation', 'volcengine_translation_subtitle'],
      ['tts.sentence_start', 'volcengine_tts'],
      ['tts.sentence_end', 'volcengine_tts'],
      ['tts.ended', 'volcengine_tts'],
      ['session.usage', 'volcengine_usage'],
      ['session.audio_muted', 'volcengine_audio_mute'],
    ];
    for (const [type, key] of keys) {
      add(type);
      add(type);
      speaker = entriesFor('speaker');
      expect(speaker[speaker.length - 1].groupingKey, type).toBe(key);
      expect(speaker[speaker.length - 1].events, type).toHaveLength(2);
    }
    expect(speaker).toHaveLength(7);
  });

  it("groups OpenAI Translate's delta frames each under its own type, and gives its other frames no key (Stage 2 OpenAI Translate, choice 12)", () => {
    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
    for (const type of ['session.input_transcript.delta', 'session.output_transcript.delta', 'session.output_audio.delta']) {
      add(type);
      add(type);
    }
    expect(entriesFor('speaker').map((e) => [e.groupingKey, e.events?.length])).toEqual([
      ['session.input_transcript.delta', 2],
      ['session.output_transcript.delta', 2],
      ['session.output_audio.delta', 2],
    ]);
    // None of its other names is a row of Doubao's (`subtitle.*`, `tts.*`, `session.usage`, `session.audio_muted`) or of anyone's: one entry each, ungrouped.
    const others = [
      'session.opened', 'session.created', 'session.update', 'session.updated', 'session.closed', 'session.error', 'session.unknown', 'session.unreadable',
      'session.socket_error', 'session.connection_lost', 'session.input_transcript.done', 'session.output_transcript.done', 'session.output_audio.done',
      'turn.tail', 'turn.tail_end',
    ];
    for (const type of others) add(type);
    expect(entriesFor('speaker').slice(3).map((e) => [e.eventType, e.groupingKey])).toEqual(others.map((type) => [type, undefined]));
  });

  it("groups OpenAI Realtime's delta frames each under its own type, and gives its other frames no key (Stage 2 OpenAI Realtime, choice 13)", () => {
    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
    const deltas = [
      'conversation.item.input_audio_transcription.delta', 'response.output_audio_transcript.delta', 'response.output_text.delta', 'response.output_audio.delta',
    ];
    for (const type of deltas) {
      add(type);
      add(type);
    }
    expect(entriesFor('speaker').map((e) => [e.groupingKey, e.events?.length])).toEqual(deltas.map((type) => [type, 2]));
    // None of its other names is the microphone's row, one of Doubao's (`subtitle.*`, `tts.*`, `session.usage`, `session.audio_muted`) or anyone's: one entry each, ungrouped.
    const others = [
      'session.opened', 'session.update', 'input_audio_buffer.commit', 'input_audio_buffer.clear', 'conversation.item.create', 'response.create', 'response.queued', 'response.anchor',
      'session.created', 'session.updated', 'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'input_audio_buffer.committed', 'input_audio_buffer.cleared',
      'conversation.item.added', 'conversation.item.done', 'conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed',
      'response.created', 'response.output_item.added', 'response.output_item.done', 'response.content_part.added', 'response.content_part.done',
      'conversation.item.deleted', 'conversation.item.truncated', 'conversation.item.input_audio_transcription.segment', 'input_audio_buffer.timeout_triggered',
      'response.output_audio_transcript.done', 'response.output_text.done', 'response.output_audio.done', 'response.done', 'rate_limits.updated',
      'session.error', 'session.unknown', 'session.unreadable', 'session.socket_error', 'session.connection_lost',
    ];
    for (const type of others) add(type);
    expect(entriesFor('speaker').slice(deltas.length).map((e) => [e.eventType, e.groupingKey])).toEqual(others.map((type) => [type, undefined]));
  });

  it("groups Palabra's streamed frames each under its own type, and gives its other frames no key (Stage 2 Palabra, choice 11)", () => {
    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
    const streamed = ['transcription.partial', 'translation.partial', 'audio.output'];
    for (const type of streamed) {
      add(type);
      add(type);
    }
    expect(entriesFor('speaker').map((e) => [e.groupingKey, e.events?.length])).toEqual(streamed.map((type) => [type, 2]));
    // None of its other names is the microphone's row, one of Doubao's (`subtitle.*`, `tts.*`, `session.usage`, `session.audio_muted`), the old client's, or anyone's: one entry each, ungrouped.
    const others = [
      'session.create', 'session.created', 'session.create_failed', 'session.opened', 'task.set', 'task.get', 'task.not_found', 'task.current',
      'transcription.validated', 'translation.final', 'audio.idle', 'audio.resumed', 'turn.flush',
      'session.warning', 'session.error', 'session.end_of_stream', 'session.unknown', 'session.unreadable', 'session.socket_error', 'session.connection_lost',
    ];
    for (const type of others) add(type);
    expect(entriesFor('speaker').slice(streamed.length).map((e) => [e.eventType, e.groupingKey])).toEqual(others.map((type) => [type, undefined]));
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

// Off until something says otherwise. Only the main window loads the settings
// that can switch it on; any other context that imports the store — the
// extension's subtitle overlay, or whatever comes next — must record nothing
// on its own (PR #538 review).
describe('logStore — initial state', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('records nothing until told to', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const { default: fresh } = await import('./logStore');

    expect(fresh.getState().enabled).toBe(false);
    fresh.getState().addLog('before any setting was read', 'error');
    vi.advanceTimersByTime(1000);
    expect(fresh.getState().allLogs).toHaveLength(0);
  });
});

// Diagnostic logs are opt-in (Help → diagnostic logs). While they are off the
// store records nothing — not the entry, and not the sanitize pass that would
// build it; a realtime session sends ~20 events a second.
describe('logStore — diagnostic logs switch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().clearLogs();
  });
  afterEach(() => {
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().clearLogs();
    vi.useRealTimers();
  });

  it('records nothing while switched off', () => {
    useLogStore.getState().setEnabled(false);
    let touched = 0;
    const event = { type: 'response.created', get data() { touched++; return {}; } } as never;
    useLogStore.getState().addRealtimeEvent(event, 'server', 'response.created', 'speaker');
    useLogStore.getState().addLog('settings failed to load', 'error');
    vi.advanceTimersByTime(1000);

    expect(useLogStore.getState().allLogs).toHaveLength(0);
    // Not even sanitised: nothing read the event's fields.
    expect(touched).toBe(0);
  });

  it('drops what it holds when switched off', () => {
    useLogStore.getState().addLog('flushed', 'error');
    vi.advanceTimersByTime(1000);
    useLogStore.getState().addLog('still pending', 'error');
    expect(useLogStore.getState().allLogs).toHaveLength(2);

    useLogStore.getState().setEnabled(false);

    expect(useLogStore.getState().allLogs).toHaveLength(0);
    expect(useLogStore.getState().pendingLogs).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(useLogStore.getState().logs).toHaveLength(0);
  });

  it('records again once switched back on', () => {
    useLogStore.getState().setEnabled(false);
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().addLog('after', 'error');
    vi.advanceTimersByTime(1000);

    expect(useLogStore.getState().allLogs.map(l => l.message)).toEqual(['after']);
  });
});
