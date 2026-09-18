import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationItem } from '../../services/interfaces/IClient';
import { teardownSessionLegs } from '../../services/providers/managedSonioxSplit';
import { mergeConversationItems } from './conversationMerge';

/**
 * Ordering coverage for MainPanel.disconnectConversation's session-end save.
 * There is no React rendering harness in this repo (see
 * splitDegradedWiring.test.ts), so `stopSession` below replays the steps
 * disconnectConversation takes, around the REAL teardownSessionLegs and
 * mergeConversationItems. Keep it in step with MainPanel.tsx.
 *
 * THE BUG (PR #537 as submitted): the save was armed inside the speaker leg and
 * fired by an effect on the next render. In split Both mode that render commits
 * while the participant leg is still awaiting disconnect(), so the other
 * party's last line — flushed by that disconnect — is not in the file.
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

const LANGS = { sourceLanguage: 'EN', targetLanguage: 'JA' };
const saved = vi.fn(async (_items: ConversationItem[]) => 'saved' as const);
const texts = (items: ConversationItem[]) => items.map(i => i.formatted?.text);

/** Replays disconnectConversation's capture-and-save steps. */
async function stopSession(opts: { wasActive: boolean; speaker?: Fake; participant?: Fake }) {
  let speakerFinal: ConversationItem[] = [];
  let participantFinal: ConversationItem[] = [];
  try {
    await teardownSessionLegs({
      speaker: async () => {
        const c = opts.speaker;
        if (!c) return;
        try { await c.disconnect(); } catch { /* MainPanel warns and carries on */ }
        speakerFinal = c.getConversationItems();
        c.reset();
      },
      participant: async () => {
        const c = opts.participant;
        if (!c) return;
        participantFinal = c.getConversationItems();
        try {
          await c.disconnect();
          participantFinal = c.getConversationItems();
          c.reset();
        } catch { /* MainPanel warns and carries on */ }
      },
    });
  } finally {
    if (opts.wasActive) {
      await saved(mergeConversationItems(speakerFinal, participantFinal, () => LANGS));
    }
  }
}

beforeEach(() => saved.mockClear());

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
    expect(texts(file)).not.toContain('THEIR-LAST');
  });

  it('Others mode, no speaker client: still saves', async () => {
    await stopSession({ wasActive: true, participant: client([line('p1', 'THEIRS', 1)]) });
    expect(texts(saved.mock.calls[0][0])).toEqual(['THEIRS']);
  });

  it('a session that never became active (Cancel during Start, connect failure) saves nothing', async () => {
    await stopSession({ wasActive: false, speaker: client([line('s1', 'MINE', 1)]) });
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

  it('a leg that throws out of teardown still gets the save, and the error still propagates', async () => {
    const speaker = client([line('s1', 'MINE', 1)]);
    speaker.reset = () => { throw new Error('reset blew up'); };
    await expect(stopSession({ wasActive: true, speaker })).rejects.toThrow('reset blew up');
    expect(texts(saved.mock.calls[0][0])).toEqual(['MINE']);
  });

  it('a close request during an in-flight Stop answers only after the file is saved', async () => {
    const order: string[] = [];
    saved.mockImplementationOnce(async () => { order.push('saved'); return 'saved'; });
    const inFlight = stopSession({
      wasActive: true,
      participant: client([line('p1', 'THEIRS', 1)], [line('p2', 'THEIR-LAST', 2)]),
    });
    // What MainPanel's close listener does: the session already reads
    // inactive, so it only awaits disconnectDoneRef, then answers.
    const onCloseRequested = async (done: Promise<void>) => {
      try { await done; } finally { order.push('close-ready'); }
    };
    await onCloseRequested(inFlight);
    expect(order).toEqual(['saved', 'close-ready']);
  });
});
