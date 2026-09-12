import { describe, it, expect } from 'vitest';

/**
 * Regression test for the participant-connect error-bubble ordering bug in
 * MainPanel.tsx's connectConversation (participant catch block, ~line 1938,
 * and the deferred append after the post-init setItems overwrite, ~line
 * 1972).
 *
 * There is no React rendering harness in this repo, so this test does not
 * mount MainPanel or invoke connectConversation directly. Instead it proves
 * the state-update ordering property the fix depends on, using a minimal
 * reimplementation of React's useState setter *value semantics*: a plain
 * value passed to the setter fully replaces state; a function passed to the
 * setter receives whatever the state currently is and its return value
 * becomes the new state. That is exactly the mechanism connectConversation
 * relies on when it calls setItems either with a plain array
 * (`speakerClientRef.current?.getConversationItems() || []`) or with an
 * updater function (`prev => [...prev, errorItem]`).
 *
 * The bug: connectConversation calls the plain-value overwrite
 * unconditionally near the end of session start. Any setItems(prev => ...)
 * append that already ran *before* that line gets discarded — the
 * overwrite doesn't know about it. An append that runs *after* the
 * overwrite instead builds on top of the now-current (overwritten) state
 * and survives.
 *
 * Each pair of tests below replays the exact call sequence for both code
 * shapes (buggy vs. fixed) against both real-world shapes of the overwrite
 * value: participant-only mode (speakerClientRef.current is null, so the
 * overwrite is `setItems([])`) and Both mode (the overwrite is the
 * speaker's just-started, non-empty conversation list).
 */

type Item = { id: string; text: string };
type Updater = Item[] | ((prev: Item[]) => Item[]);

function makeStateContainer(initial: Item[]) {
  let state = initial;
  const setItems = (updater: Updater) => {
    state = typeof updater === 'function' ? (updater as (prev: Item[]) => Item[])(state) : updater;
  };
  return { setItems, getState: () => state };
}

const errorItem: Item = { id: 'error-1', text: 'Failed to start the participant audio channel.' };

describe('participant-connect error bubble vs. the post-init setItems overwrite', () => {
  describe('pre-fix ordering (append runs BEFORE the overwrite) — reproduces the bug', () => {
    it('participant-only shape: bubble is wiped by setItems([])', () => {
      const { setItems, getState } = makeStateContainer([]);
      // catch block appends immediately, as the pre-fix code did
      setItems(prev => [...prev, errorItem]);
      // unconditional overwrite that ran after — speakerClientRef.current is
      // null in participant-only mode
      setItems([]);
      expect(getState()).toEqual([]); // bubble is gone
    });

    it('Both-mode shape: bubble is wiped by the speaker\'s list', () => {
      const { setItems, getState } = makeStateContainer([]);
      setItems(prev => [...prev, errorItem]);
      const speakerItems: Item[] = [{ id: 'speaker-1', text: 'hello' }];
      setItems(speakerItems);
      expect(getState()).toEqual(speakerItems); // bubble is gone, replaced by speaker items only
    });
  });

  describe('fixed ordering (append runs AFTER the overwrite) — current MainPanel.tsx behavior', () => {
    it('participant-only shape: bubble survives setItems([])', () => {
      const { setItems, getState } = makeStateContainer([]);
      setItems([]); // speakerClientRef.current is null -> overwrite with []
      setItems(prev => [...prev, errorItem]); // deferred append, per the fix
      expect(getState()).toEqual([errorItem]);
    });

    it('Both-mode shape: bubble survives being appended after the speaker\'s list', () => {
      const { setItems, getState } = makeStateContainer([]);
      const speakerItems: Item[] = [{ id: 'speaker-1', text: 'hello' }];
      setItems(speakerItems); // overwrite with the speaker's just-started list
      setItems(prev => [...prev, errorItem]); // deferred append, per the fix
      expect(getState()).toEqual([...speakerItems, errorItem]);
    });
  });
});

/**
 * The same overwrite hazard at the other end of the session.
 *
 * disconnectConversation's speaker leg ends with
 * `setItems(client.getConversationItems()); client.reset();` — the plain-value
 * overwrite again. It is correct for the session that owned the client: it
 * captures the final transcript before reset empties it.
 *
 * It was wrong for the NEXT session, because `speakerClientRef.current` was
 * never cleared. Participant-only ("Others") mode builds no speaker client at
 * all, so its Stop reached this leg holding the previous session's object —
 * already `reset()`, so `getConversationItems()` returns `[]`, so the overwrite
 * is `setItems([])`. In Others mode `items` is not empty: it carries the
 * participant-channel warning and the descriptor's prepare notices. Those rows
 * vanished at Stop, silently.
 *
 * The fix is the null the participant leg always had. Modelled here the same
 * way as above — the leg's `if (!client) return` is what the "fixed" case
 * asserts, and there is still no React harness to mount MainPanel with.
 */
describe('stale speaker client vs. the teardown setItems overwrite', () => {
  /** The tail of disconnectConversation's speaker leg. */
  const teardownSpeakerLeg = (
    setItems: (u: Updater) => void,
    client: { getConversationItems: () => Item[] } | null,
  ) => {
    if (!client) return;
    setItems(client.getConversationItems());
  };

  /** A client from an earlier session: disconnected and already reset, so empty. */
  const staleClient = { getConversationItems: (): Item[] => [] };

  const othersModeRows: Item[] = [
    { id: 'warn-1', text: "Failed to start Other's audio channel." },
    { id: 'notice-1', text: 'Prepare notice' },
  ];

  it('pre-fix: an Others-mode Stop wipes the warning and notice rows', () => {
    const { setItems, getState } = makeStateContainer(othersModeRows);

    // The ref still held the previous session's client, so the leg ran.
    teardownSpeakerLeg(setItems, staleClient);

    expect(getState()).toEqual([]); // both rows gone, no error, no log
  });

  it('cleared ref: the leg is skipped and the rows survive Stop', () => {
    const { setItems, getState } = makeStateContainer(othersModeRows);

    // Stop now nulls speakerClientRef, so a session that built no speaker
    // client finds nothing to tear down.
    teardownSpeakerLeg(setItems, null);

    expect(getState()).toEqual(othersModeRows);
  });

  it('still captures the final transcript for the session that owned the client', () => {
    const finalTranscript: Item[] = [{ id: 'speaker-1', text: 'hello' }];
    const { setItems, getState } = makeStateContainer([{ id: 'stale', text: 'mid-stream' }]);

    // The overwrite is not being removed — this is the case it exists for.
    teardownSpeakerLeg(setItems, { getConversationItems: () => finalTranscript });

    expect(getState()).toEqual(finalTranscript);
  });
});

/**
 * The clear must not wipe a session it does not own.
 *
 * disconnectConversation flips isSessionActive to false synchronously — which
 * re-enables the Start button — and only then awaits (pauseRecording, a 100 ms
 * settle, `client.disconnect()`). Nothing serializes a new Start behind that
 * in-flight Stop, so a Stop→Start double-tap can put the NEXT session's client
 * in `speakerClientRef` while the old teardown is still running. Two things
 * then have to hold:
 *
 *  - the leg must tear down the client this Stop OWNED, not whatever the ref
 *    holds by the time the leg runs — hence the capture at the top of
 *    disconnectConversation, before any await;
 *  - the clear must be compare-and-clear, so a ref that now points at the new
 *    session's client is left alone.
 *
 * An unconditional `ref.current = null` there produced a live session with a
 * null speaker ref: every audio frame dropped, nothing on screen, and the next
 * Stop skipping the leg so the provider session was never closed.
 */
describe('teardown vs. a Start that lands mid-Stop', () => {
  type Client = { getConversationItems: () => Item[] };

  /** disconnectConversation's capture-then-tear-down shape, with the ref modelled. */
  const runTeardown = (
    ref: { current: Client | null },
    captured: Client | null,
    setItems: (u: Updater) => void,
  ) => {
    const client = captured;
    if (!client) return;
    setItems(client.getConversationItems());
    if (ref.current === client) ref.current = null;
  };

  const oldClient: Client = { getConversationItems: () => [{ id: 'old-1', text: 'final line' }] };
  const newClient: Client = { getConversationItems: () => [] };

  it('a plain Stop clears the ref', () => {
    const ref = { current: oldClient as Client | null };
    const captured = ref.current; // top of disconnectConversation
    const { setItems, getState } = makeStateContainer([]);

    runTeardown(ref, captured, setItems);

    expect(ref.current).toBeNull();
    expect(getState()).toEqual([{ id: 'old-1', text: 'final line' }]);
  });

  it('a Start that lands during the old teardown keeps its client', () => {
    const ref = { current: oldClient as Client | null };
    const captured = ref.current; // top of disconnectConversation
    const { setItems } = makeStateContainer([]);

    // Start clicked inside the teardown's await window: the new session has
    // already assigned its client before the old leg gets to run.
    ref.current = newClient;

    runTeardown(ref, captured, setItems);

    // The old client was torn down (captured), and the new one is untouched.
    expect(ref.current).toBe(newClient);
  });

  it('the pre-fix shape wiped the new session', () => {
    // What an unconditional clear did in the same interleaving.
    const ref = { current: oldClient as Client | null };
    const captured = ref.current;
    ref.current = newClient;

    if (captured) ref.current = null; // the bare `= null` this test guards against

    expect(ref.current).toBeNull(); // the live session just lost its client
  });
});

/**
 * Start must wait for an in-flight Stop — the whole class, not one ref.
 *
 * The capture + compare-and-clear above makes the SPEAKER ref safe across a
 * Stop→Start overlap. It does nothing for the three other things the old
 * teardown touches at run time: the participant leg reads and clears whatever
 * `participantClientRef` holds, `afterBothLegs` reads and releases whatever
 * `sessionResourcesRef` holds (the managed-Soniox lease), and the trailing
 * `audioService.stopRecording()` stops whatever the shared recorder is doing.
 * A Start that landed inside the window lost all three to the previous Stop.
 *
 * The fix is to serialize: disconnectConversation exposes a done-promise from
 * before its first await, and connectConversation awaits it before touching
 * any of that state. Modelled below with the same stand-in approach as the
 * rest of this file; the shared state is what the teardown reads at run time.
 */
describe('a Start that lands mid-Stop waits for the teardown to finish', () => {
  type Shared = { participant: string | null; resources: string | null; recording: string | null };

  function makeSession() {
    const shared: Shared = { participant: 'old-p', resources: 'old-r', recording: 'old-rec' };
    let done: Promise<void> | null = null;
    let release: () => void = () => {};
    // Stands in for the awaits inside disconnectConversation (pauseRecording,
    // the 100 ms settle, `client.disconnect()`): the window a Start can land in.
    const gap = new Promise<void>(r => { release = r; });

    const stop = async () => {
      let markDone: () => void = () => {};
      done = new Promise<void>(r => { markDone = r; }); // before any await
      await gap;
      shared.participant = null; // participant leg: reads the ref at run time
      shared.resources = null;   // afterBothLegs: reads sessionResourcesRef at run time
      shared.recording = null;   // stopRecording on the shared audio service
      done = null;
      markDone();                // the finally
    };
    const start = async (waitsForStop: boolean) => {
      const pending = done;
      if (waitsForStop && pending) await pending;
      shared.participant = 'new-p';
      shared.resources = 'new-r';
      shared.recording = 'new-rec';
    };
    return { shared, stop, start, release };
  }

  it('pre-fix: a Start inside the window is torn down by the old Stop', async () => {
    const s = makeSession();
    const stopping = s.stop();
    await s.start(false);   // assigns immediately, inside the gap
    s.release();
    await stopping;         // the old teardown now clears the NEW session's state

    expect(s.shared).toEqual({ participant: null, resources: null, recording: null });
  });

  it('fixed: the Start parks on the done-promise and then owns its state', async () => {
    const s = makeSession();
    const stopping = s.stop();
    const starting = s.start(true); // waits
    s.release();
    await stopping;
    await starting;

    expect(s.shared).toEqual({ participant: 'new-p', resources: 'new-r', recording: 'new-rec' });
  });

  it('with no Stop in flight, a Start does not wait on anything', async () => {
    const s = makeSession();
    // `done` is null — nothing to await, and nothing here would ever resolve
    // `gap`, so hanging on it would fail this test by timeout.
    await s.start(true);

    expect(s.shared.participant).toBe('new-p');
  });
});
