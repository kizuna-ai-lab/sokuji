import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationItem } from '../../services/interfaces/IClient';
import { teardownSessionLegs } from '../../services/providers/managedSonioxSplit';
import { keepRowsDroppedOnDisconnect, mergeConversationItems } from './conversationMerge';

/**
 * Ordering coverage for MainPanel.disconnectConversation's session-end save,
 * and for the desktop close-handshake listener that waits on it. There is no
 * React rendering harness in this repo (see splitDegradedWiring.test.ts), so
 * `stopSession` below replays the steps disconnectConversation takes, around
 * the REAL teardownSessionLegs and mergeConversationItems, and `onCloseRequested`
 * replays the 'app:close-requested' listener. Keep both in step with
 * MainPanel.tsx.
 *
 * THE BUG (PR #537 as submitted): the save was armed inside the speaker leg and
 * fired by an effect on the next render. In split Both mode that render commits
 * while the participant leg is still awaiting disconnect(), so the other
 * party's last line — flushed by that disconnect — is not in the file.
 *
 * THE BUG this file's close-in-flight cases guard against (review round 1):
 * disconnectDoneRef must be published before the save's first await and
 * resolved only after the save, or a close request racing an in-flight Stop
 * can answer 'app:close-ready' before the file is written. `stopSession`'s
 * `done` param models the correct order; `stopSessionPublishingLate` models
 * the bug and is asserted to reorder ['close-ready', 'saved'] — proof the
 * assertions above it can actually fail.
 */

type Fake = {
  disconnect: () => Promise<void>;
  getConversationItems: () => ConversationItem[];
  reset: () => void;
};

const line = (id: string, text: string, createdAt: number): ConversationItem => ({
  id, role: 'user', type: 'message', status: 'completed', createdAt, formatted: { text },
} as ConversationItem);

/** A client whose disconnect() flushes `flushed` into its items, like a real final completion. */
function client(items: ConversationItem[], flushed: ConversationItem[] = [], fail = false): Fake {
  let current = [...items];
  return {
    disconnect: async () => {
      await Promise.resolve();
      current = [...current, ...flushed];
      if (fail) throw new Error('socket already closed');
    },
    getConversationItems: () => [...current],
    reset: () => { current = []; },
  };
}

/**
 * A client that empties its items inside disconnect(), like PalabraAIClient
 * and the Compatible provider's OpenAIClient.
 */
function clientThatEmptiesOnDisconnect(items: ConversationItem[]): Fake {
  let current = [...items];
  return {
    disconnect: async () => {
      await Promise.resolve();
      current = [];
    },
    getConversationItems: () => [...current],
    reset: () => { current = []; },
  };
}

const LANGS = { sourceLanguage: 'EN', targetLanguage: 'JA' };
const languageOf = vi.fn((_id: string) => LANGS);
const saved = vi.fn(async (_items: ConversationItem[]) => 'saved' as const);
/** Stands in for the speaker leg's setItems(): what the stopped view shows. */
const shown = vi.fn((_items: ConversationItem[]) => {});
const texts = (items: ConversationItem[]) => items.map(i => i.formatted?.text);

/**
 * Replays disconnectConversation's capture-and-save steps. When `done` is
 * given, it mirrors disconnectDoneRef the way MainPanel.tsx does: published
 * synchronously, before the first await (MainPanel.tsx, right after the
 * re-entry guard), and resolved in this function's own outer `finally` —
 * after the save, which the inner `finally` above it has already awaited.
 * Existing callers that omit `done` are unaffected.
 */
async function stopSession(opts: {
  wasActive: boolean;
  /** The auto-save setting; on unless a case says otherwise. */
  autoSaveOnStop?: boolean;
  speaker?: Fake;
  participant?: Fake;
  /** participantClientRef, for cases that follow the client across sessions; else one holding `participant`. */
  participantRef?: { current: Fake | null };
  done?: { current: Promise<void> | null };
}) {
  let markDone: () => void = () => {};
  if (opts.done) {
    opts.done.current = new Promise<void>(resolve => { markDone = resolve; });
  }
  let speakerFinal: ConversationItem[] = [];
  let participantFinal: ConversationItem[] = [];
  try {
    try {
      await teardownSessionLegs({
        speaker: async () => {
          const c = opts.speaker;
          if (!c) return;
          const before = c.getConversationItems();
          try { await c.disconnect(); } catch { /* MainPanel warns and carries on */ }
          speakerFinal = keepRowsDroppedOnDisconnect(before, c.getConversationItems());
          shown(speakerFinal);
          c.reset();
        },
        participant: async () => {
          const ref = opts.participantRef ?? { current: opts.participant ?? null };
          const c = ref.current;
          if (!c) return;
          const before = c.getConversationItems();
          try {
            await c.disconnect();
          } catch { /* MainPanel warns and carries on */ } finally {
            participantFinal = keepRowsDroppedOnDisconnect(before, c.getConversationItems());
            c.reset();
            if (ref.current === c) ref.current = null;
          }
        },
      });
    } finally {
      if (opts.wasActive && (opts.autoSaveOnStop ?? true)) {
        await saved(mergeConversationItems(speakerFinal, participantFinal, languageOf));
      }
    }
  } finally {
    if (opts.done) markDone();
  }
}

/**
 * Contrast for the close-in-flight cases below: publishes `done` only after
 * teardown settles, instead of before the first await like `stopSession`
 * does. This is the bug the ordering coverage exists to catch — a close
 * request that reads `done.current` before this line runs sees null, so
 * `await done.current` resolves at once instead of waiting for the save.
 */
async function stopSessionPublishingLate(opts: {
  wasActive: boolean;
  participant?: Fake;
  done: { current: Promise<void> | null };
}) {
  let markDone: () => void = () => {};
  let participantFinal: ConversationItem[] = [];
  try {
    try {
      await teardownSessionLegs({
        participant: async () => {
          const c = opts.participant;
          if (!c) return;
          const before = c.getConversationItems();
          try {
            await c.disconnect();
          } catch { /* MainPanel warns and carries on */ } finally {
            participantFinal = keepRowsDroppedOnDisconnect(before, c.getConversationItems());
            c.reset();
          }
        },
      });
    } finally {
      opts.done.current = new Promise<void>(resolve => { markDone = resolve; });
      if (opts.wasActive) {
        await saved(mergeConversationItems([], participantFinal, () => LANGS));
      }
    }
  } finally {
    markDone();
  }
}

/**
 * Replays MainPanel's 'app:close-requested' listener (MainPanel.tsx): if the
 * session still reads active, end it; either way, wait for disconnectDoneRef
 * (covers a Stop already in flight — the re-entry guard makes a second
 * disconnectConversation() call return at once); answer only once both have
 * settled.
 */
const onCloseRequested = async (
  isSessionActive: boolean,
  disconnect: () => Promise<void>,
  done: { current: Promise<void> | null },
  ready: () => void,
) => {
  try {
    if (isSessionActive) await disconnect();
    await done.current;
  } finally {
    ready();
  }
};

beforeEach(() => { saved.mockClear(); shown.mockClear(); languageOf.mockClear(); });

describe('session-end auto-save ordering', () => {
  it('Both mode: the line the other party finishes during disconnect() is in the file', async () => {
    await stopSession({
      wasActive: true,
      speaker: client([line('s1', 'MINE', 1)]),
      participant: client([line('p1', 'THEIRS', 2)], [line('p2', 'THEIR-LAST', 3)]),
    });
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE', 'THEIRS', 'THEIR-LAST']);
  });

  it('pre-fix contrast: saving on the render the speaker leg causes loses that line', async () => {
    const speaker = client([line('s1', 'MINE', 1)]);
    const participant = client([line('p1', 'THEIRS', 2)], [line('p2', 'THEIR-LAST', 3)]);
    let participantState = participant.getConversationItems(); // what React held mid-session
    let file: ConversationItem[] = [];
    await teardownSessionLegs({
      speaker: async () => {
        await speaker.disconnect();
        const speakerState = speaker.getConversationItems();
        speaker.reset();
        file = [...speakerState, ...participantState]; // the PR's effect, on this render
      },
      participant: async () => {
        await participant.disconnect();
        participantState = participant.getConversationItems();
        participant.reset();
      },
    });
    expect(texts(file)).toEqual(['MINE', 'THEIRS']);
  });

  it('a speaker client that empties its items on disconnect() (PalabraAI, Compatible OpenAI) still saves and shows them', async () => {
    await stopSession({
      wasActive: true,
      speaker: clientThatEmptiesOnDisconnect([line('s1', 'MINE', 1), line('s2', 'MINE-2', 3)]),
      participant: client([line('p1', 'THEIRS', 2)]),
    });
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE', 'THEIRS', 'MINE-2']);
    expect(texts(shown.mock.calls[0][0])).toEqual(['MINE', 'MINE-2']);
  });

  it('a participant client that empties its items on disconnect() (PalabraAI, Compatible OpenAI) still saves them', async () => {
    await stopSession({
      wasActive: true,
      speaker: client([line('s1', 'MINE', 1)]),
      participant: clientThatEmptiesOnDisconnect([line('p1', 'THEIRS', 2)]),
    });
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE', 'THEIRS']);
  });

  it('a row disconnect() finalizes is saved once, in its final form', async () => {
    let current = [line('s1', 'HAL', 1)];
    const speaker: Fake = {
      disconnect: async () => { current = [line('s1', 'HALF DONE', 1)]; },
      getConversationItems: () => [...current],
      reset: () => { current = []; },
    };
    await stopSession({ wasActive: true, speaker });
    expect(texts(saved.mock.calls[0][0])).toEqual(['HALF DONE']);
  });

  it('Others mode, no speaker client: still saves', async () => {
    await stopSession({ wasActive: true, participant: client([line('p1', 'THEIRS', 1)]) });
    expect(texts(saved.mock.calls[0][0])).toEqual(['THEIRS']);
  });

  it('a session that never became active (Cancel during Start, connect failure) saves nothing', async () => {
    await stopSession({ wasActive: false, speaker: client([line('s1', 'MINE', 1)]) });
    expect(saved).not.toHaveBeenCalled();
  });

  it('auto-save off: no snapshot is built, nothing is saved', async () => {
    await stopSession({ wasActive: true, autoSaveOnStop: false, speaker: client([line('s1', 'MINE', 1)]) });
    expect(languageOf).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it("a participant disconnect that throws still leaves that side's lines in the file", async () => {
    await stopSession({
      wasActive: true,
      speaker: client([line('s1', 'MINE', 1)]),
      participant: client([line('p1', 'THEIRS', 2)], [], true),
    });
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE', 'THEIRS']);
  });

  it('a participant disconnect that throws still releases the client: the next session saves none of its lines', async () => {
    const participant = client([line('p1', 'THEIRS', 2)], [], true);
    const participantRef: { current: Fake | null } = { current: participant };
    await stopSession({ wasActive: true, speaker: client([line('s1', 'MINE', 1)]), participantRef });
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE', 'THEIRS']);
    expect(participant.getConversationItems()).toEqual([]);
    expect(participantRef.current).toBeNull();
    // A later speaker-only session builds no participant client.
    await stopSession({ wasActive: true, speaker: client([line('s2', 'NEXT', 3)]), participantRef });
    expect(texts(saved.mock.calls[1][0])).toEqual(['NEXT']);
  });

  it('a participant client a new Start put in the ref during disconnect() is left there', async () => {
    const next = client([]);
    const old = client([line('p1', 'THEIRS', 1)]);
    const participantRef: { current: Fake | null } = { current: old };
    const disconnect = old.disconnect;
    old.disconnect = async () => {
      await disconnect();
      participantRef.current = next;
    };
    await stopSession({ wasActive: true, participantRef });
    expect(participantRef.current).toBe(next);
  });

  it('a leg that throws out of teardown still gets the save, and the error still propagates', async () => {
    const speaker = client([line('s1', 'MINE', 1)]);
    speaker.reset = () => { throw new Error('reset blew up'); };
    await expect(stopSession({ wasActive: true, speaker })).rejects.toThrow('reset blew up');
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE']);
  });

  it('a close request during an in-flight Stop answers only after the file is saved', async () => {
    const order: string[] = [];
    saved.mockImplementationOnce(async () => { order.push('saved'); return 'saved'; });
    // The Stop is already running (e.g. the user clicked Stop just before
    // closing): isSessionActive already reads false, so the listener skips
    // its own disconnect() call and only waits on disconnectDoneRef.
    const done: { current: Promise<void> | null } = { current: null };
    const inFlight = stopSession({
      wasActive: true,
      participant: client([line('p1', 'THEIRS', 1)], [line('p2', 'THEIR-LAST', 2)]),
      done,
    });
    await onCloseRequested(false, async () => {}, done, () => order.push('close-ready'));
    await inFlight;
    expect(order).toEqual(['saved', 'close-ready']);
  });

  it('a close request on a still-active session ends it, then answers only after the file is saved', async () => {
    const order: string[] = [];
    saved.mockImplementationOnce(async () => { order.push('saved'); return 'saved'; });
    // The session is still active when the close arrives: the listener calls
    // disconnectConversation() itself (isSessionActive === true).
    const done: { current: Promise<void> | null } = { current: null };
    await onCloseRequested(
      true,
      () => stopSession({
        wasActive: true,
        participant: client([line('p1', 'THEIRS', 1)], [line('p2', 'THEIR-LAST', 2)]),
        done,
      }),
      done,
      () => order.push('close-ready'),
    );
    expect(order).toEqual(['saved', 'close-ready']);
  });

  it('contrast: publishing done late lets the close answer race ahead of the save', async () => {
    const order: string[] = [];
    saved.mockImplementationOnce(async () => { order.push('saved'); return 'saved'; });
    const done: { current: Promise<void> | null } = { current: null };
    const inFlight = stopSessionPublishingLate({
      wasActive: true,
      participant: client([line('p1', 'THEIRS', 1)], [line('p2', 'THEIR-LAST', 2)]),
      done,
    });
    await onCloseRequested(false, async () => {}, done, () => order.push('close-ready'));
    await inFlight;
    expect(order).toEqual(['close-ready', 'saved']);
  });
});
