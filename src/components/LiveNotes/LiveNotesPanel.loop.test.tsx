// The live notes loop wired to the panel's store the way the app session wires it
// (src/app/session.ts: onState -> update(recordId), onHint -> setHint(recordId)), on a virtual clock with a model the
// test answers by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, act } from '@testing-library/react';
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true,
}));
import i18n from '../../locales';
import zhCN from '../../locales/zh_CN/translation.json';
import { createVirtualClock } from '../../lib/contract/clock';
import type { ChatPort, ChatRequest } from '../../lib/notes/chat';
import { createLiveNotes, LIVE_INTERVAL_MS } from '../../lib/notes/live/loop';
import { useLiveNotes } from '../../lib/notes/live/liveStore';
import { useLiveNotesLayout } from '../../lib/notes/live/livePanel';
import { applyLive, type LiveSentence, type LiveState } from '../../lib/notes/live/state';
import useSettingsStore from '../../stores/settingsStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import LiveNotesPanel from './LiveNotesPanel';

const RECORD = 'run-0001-aaaa';
const s = (n: number): LiveSentence => ({
  n, side: 'other', sideCertain: true, track: 'other', speaker: '1.1', startMs: n * 5_000, endMs: n * 5_000 + 4_000,
  text: `sentence ${n}`, timeKind: 'given', fromOpen: false,
} as LiveSentence);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/** A model the test answers by hand (as loop.test.ts's handModel). */
function handModel() {
  const calls: Array<{ r: ChatRequest; answer(v: unknown): void; fail(e: unknown): void }> = [];
  const chat: ChatPort = (r) => new Promise((resolve, reject) => {
    calls.push({ r, answer: resolve, fail: reject });
    r.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  return { chat, calls, fresh: (i: number) => (calls[i].r.user as { new: Array<{ sid: number }> }).new.map((x) => x.sid) };
}

let dispose: (() => void) | null = null;

/** The loop, the store and the panel, as one session shows them. */
function wired() {
  const clock = createVirtualClock(0);
  const model = handModel();
  useLiveNotes.getState().begin(RECORD);
  const live = createLiveNotes({
    chat: model.chat, clock, language: { code: 'en', name: 'English' }, speakerLabel: () => 'Other side',
    onState: (st) => useLiveNotes.getState().update(RECORD, st),
    onHint: (h) => useLiveNotes.getState().setHint(RECORD, h),
  });
  dispose = () => live.dispose();
  render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
  const panel = () => screen.getByRole('complementary', { name: /Live notes|实时纪要/ });
  return {
    clock, model, live, panel, fresh: model.fresh,
    say: (...ns: number[]) => live.sentences(ns.map(s)),
    advance: (ms: number) => act(async () => { clock.advance(ms); await flush(); }),
    answer: (i: number, v: unknown) => act(async () => { model.calls[i].answer(v); await flush(); }),
    fail: (i: number) => act(async () => { model.calls[i].fail(new TypeError('Failed to fetch')); await flush(); }),
    topics: () => within(panel()).queryAllByRole('heading', { level: 4 }).map((h) => h.textContent),
    points: () => within(panel()).queryAllByRole('listitem').map((li) => li.textContent),
  };
}

beforeEach(() => {
  useSettingsStore.setState({ liveNotes: true, notesAfterSession: false } as never);
  useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' } } as never);
  useLiveNotesLayout.setState({ layout: 'both' });
});
afterEach(async () => {
  dispose?.();
  dispose = null;
  cleanup();
  useLiveNotes.getState().reset();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

const opening = (title: string, topic: string, points: Array<{ text: string; sid: number; kinds?: string[] }>) =>
  ({ title, new_topic: { title: topic, summary: '', points: points.map((p) => ({ kinds: [], ...p })) } });

describe('the panel grows with the session', () => {
  it('shows the title and the first topic from the first update, due 20 seconds after the first sentences', async () => {
    const w = wired();
    w.say(1, 2);
    await w.advance(LIVE_INTERVAL_MS - 1);
    expect(w.model.calls).toHaveLength(0);
    expect(within(w.panel()).getByText('Notes appear here as the conversation goes on.')).toBeInTheDocument();
    await w.advance(1);
    expect(w.fresh(0)).toEqual([1, 2]);
    await w.answer(0, opening('Supplier sync', 'Delivery', [{ text: 'Ships Tuesday', sid: 1 }]));
    expect(within(w.panel()).getByRole('heading', { level: 3, name: 'Supplier sync' })).toBeInTheDocument();
    expect(w.topics()).toEqual(['Delivery (now)']);
    expect(within(w.panel()).queryByText('Notes appear here as the conversation goes on.')).toBeNull();
  });

  it('adds each new topic after the earlier ones, in the order they came, only the newest marked as open', async () => {
    const w = wired();
    w.say(1, 2);
    await w.advance(LIVE_INTERVAL_MS);
    await w.answer(0, opening('Supplier sync', 'Delivery', [{ text: 'Ships Tuesday', sid: 1 }]));
    w.say(3);
    await w.advance(LIVE_INTERVAL_MS);
    await w.answer(1, { new_topic: { title: 'Budget', summary: '', points: [{ text: 'Travel down', sid: 3, kinds: [] }] } });
    expect(w.topics()).toEqual(['Delivery', 'Budget (now)']);
    w.say(4);
    await w.advance(LIVE_INTERVAL_MS);
    await w.answer(2, { new_topic: { title: 'Hiring', summary: '', points: [{ text: 'Two roles open', sid: 4, kinds: [] }] } });
    expect(w.topics()).toEqual(['Delivery', 'Budget', 'Hiring (now)']);
    expect(w.points()).toEqual(['Ships Tuesday', 'Travel down', 'Two roles open']);
  });

  it('in Chinese marks the open topic 「（进行中）」', async () => {
    i18n.addResourceBundle('zh_CN', 'translation', zhCN, true, true);
    await i18n.changeLanguage('zh_CN');
    const w = wired();
    w.say(1);
    await w.advance(LIVE_INTERVAL_MS);
    await w.answer(0, opening('周会', '交付', [{ text: '周二发货', sid: 1 }]));
    w.say(2);
    await w.advance(LIVE_INTERVAL_MS);
    await w.answer(1, { new_topic: { title: '预算', summary: '', points: [{ text: '差旅减少', sid: 2, kinds: [] }] } });
    expect(w.topics()).toEqual(['交付', '预算（进行中）']);
  });
});

describe('append only: a written point is never rewritten', () => {
  it('keeps written points word for word, adds a repeat of the same text once, and drops only the to-do mark when withdrawn', async () => {
    const w = wired();
    w.say(1);
    await w.advance(LIVE_INTERVAL_MS);
    await w.answer(0, opening('Supplier sync', 'Delivery', [
      { text: 'Ship on Tuesday', sid: 1, kinds: ['decision'] },
      { text: 'Send the tracking link', sid: 1, kinds: ['todo'] },
    ]));
    const before = w.points();
    expect(before).toEqual(['Ship on TuesdayDecision', 'Send the tracking linkTo do']);

    // The same decision said again: the update carries what is already written, and the same text is not added twice.
    w.say(2);
    await w.advance(LIVE_INTERVAL_MS);
    const sent = w.model.calls[1].r.user as { current_topic: { points: unknown[] } };
    expect(sent.current_topic.points).toContainEqual({ text: 'Ship on Tuesday', kinds: ['decision'] });
    // An answer has no way to edit a point: a `points` list on the open topic is not read, only `add`.
    await w.answer(1, { current_topic: {
      add: [{ text: 'Ship on Tuesday', sid: 2, kinds: ['decision'] }],
      points: [{ text: 'Ship on Wednesday', sid: 2, kinds: ['decision'] }],
    } });
    expect(w.points()).toEqual(before);
    expect(within(w.panel()).queryByText('Ship on Wednesday')).toBeNull();

    // "That to-do is not needed any more": the mark goes, the text stays.
    w.say(3);
    await w.advance(LIVE_INTERVAL_MS);
    expect((w.model.calls[2].r.user as { todos: unknown[] }).todos).toEqual([{ id: 't1', text: 'Send the tracking link' }]);
    await w.answer(2, { withdraw: ['t1'] });
    expect(w.points()).toEqual(['Ship on TuesdayDecision', 'Send the tracking link']);
  });
});

describe('a topic is closed once it has 12 points', () => {
  const sentence = (n: number) => s(n);
  const add = (st: LiveState, n: number) =>
    applyLive(st, { current_topic: { add: [{ text: `p${n}`, sid: n, kinds: [] }] } }, { fresh: [sentence(n)], seen: [sentence(n)], speakerLabel: () => 'x' })!;

  it('no longer marks the full topic open; what is written into it after that shows under "<title> (2)", then "(3)", never "(2) (2)"', () => {
    let st = applyLive({ title: null, topics: [] }, opening('T', 'Delivery', [{ text: 'p1', sid: 1 }]), { fresh: [s(1)], seen: [s(1)], speakerLabel: () => 'x' })!;
    for (let n = 2; n <= 11; n++) st = add(st, n);
    useLiveNotes.getState().begin(RECORD);
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    const headings = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    act(() => useLiveNotes.getState().update(RECORD, st));
    expect(headings()).toEqual(['Delivery (now)']);
    st = add(st, 12);
    act(() => useLiveNotes.getState().update(RECORD, st));
    expect(headings()).toEqual(['Delivery']);
    st = add(st, 13);
    act(() => useLiveNotes.getState().update(RECORD, st));
    expect(headings()).toEqual(['Delivery', 'Delivery (2) (now)']);
    for (let n = 14; n <= 25; n++) st = add(st, n);
    act(() => useLiveNotes.getState().update(RECORD, st));
    expect(headings()).toEqual(['Delivery', 'Delivery (2)', 'Delivery (3) (now)']);
    expect(headings().some((h) => /\(2\) \(2\)/.test(h ?? ''))).toBe(false);
  });
});

describe('an update failing does not interrupt the session', () => {
  it('a minute and more without network: one hint, the notes on screen unchanged; back online the hint goes and what was said meanwhile comes in', async () => {
    const w = wired();
    w.say(1);
    await w.advance(LIVE_INTERVAL_MS);
    await w.answer(0, opening('Supplier sync', 'Delivery', [{ text: 'Ships Tuesday', sid: 1 }]));
    const shown = w.panel().querySelector('.live-notes__body')!.innerHTML;

    // Offline for 100 s: five rounds fail, one sentence said in each.
    for (let i = 1; i <= 5; i++) {
      w.say(1 + i);
      await w.advance(LIVE_INTERVAL_MS);
      await w.fail(i);
      if (i < 3) expect(within(w.panel()).queryByRole('status')).toBeNull();
      else expect(within(w.panel()).getAllByRole('status')).toHaveLength(1);
    }
    expect(within(w.panel()).getByRole('status')).toHaveTextContent('Live notes could not be updated. They will try again.');
    expect(w.topics()).toEqual(['Delivery (now)']);
    expect(w.points()).toEqual(['Ships Tuesday']);
    // Only the hint line was added to what was on screen.
    const now = w.panel().querySelector('.live-notes__body')!.cloneNode(true) as HTMLElement;
    now.querySelector('[role="status"]')!.remove();
    expect(now.innerHTML).toBe(shown);

    // Back online: the next round carries every sentence said while offline.
    w.say(7);
    await w.advance(LIVE_INTERVAL_MS);
    expect(w.fresh(6)).toEqual([2, 3, 4, 5, 6, 7]);
    await w.answer(6, { current_topic: { add: [{ text: 'Boxes redone', sid: 3, kinds: [] }, { text: 'Customs form ready', sid: 6, kinds: [] }] } });
    expect(within(w.panel()).queryByRole('status')).toBeNull();
    expect(w.points()).toEqual(['Ships Tuesday', 'Boxes redone', 'Customs form ready']);
  });

  it('says it in Chinese as 「实时纪要暂时没能更新，会自动重试。」', async () => {
    i18n.addResourceBundle('zh_CN', 'translation', zhCN, true, true);
    await i18n.changeLanguage('zh_CN');
    const w = wired();
    w.say(1);
    for (let i = 0; i < 3; i++) {
      await w.advance(LIVE_INTERVAL_MS);
      await w.fail(i);
    }
    expect(within(w.panel()).getByRole('status')).toHaveTextContent('实时纪要暂时没能更新，会自动重试。');
  });
});

describe('an update failing or timing out, and trying again', () => {
  it('shows nothing for one failed update, and the next round tries its sentences again', async () => {
    const w = wired();
    w.say(1);
    await w.advance(LIVE_INTERVAL_MS);
    await w.fail(0);
    expect(within(w.panel()).queryByRole('status')).toBeNull();
    expect(within(w.panel()).getByText('Notes appear here as the conversation goes on.')).toBeInTheDocument();
    await w.advance(LIVE_INTERVAL_MS);
    expect(w.fresh(1)).toEqual([1]);
    await w.answer(1, opening('Supplier sync', 'Delivery', [{ text: 'Ships Tuesday', sid: 1 }]));
    expect(w.points()).toEqual(['Ships Tuesday']);
    expect(useLiveNotes.getState()).toMatchObject({ running: true, hint: false });
  });

  it('gives up an update that has not answered when the next is due, shows nothing for it, and the late answer changes nothing', async () => {
    const w = wired();
    w.say(1);
    await w.advance(LIVE_INTERVAL_MS);
    w.say(2);
    await w.advance(LIVE_INTERVAL_MS);
    expect(w.model.calls[0].r.signal.aborted).toBe(true);
    expect(w.fresh(1)).toEqual([1, 2]);
    expect(within(w.panel()).queryByRole('status')).toBeNull();
    await w.answer(0, opening('Late', 'Late topic', [{ text: 'late', sid: 1 }]));
    expect(w.topics()).toEqual([]);
    await w.answer(1, opening('Supplier sync', 'Delivery', [{ text: 'Ships Tuesday', sid: 2 }]));
    expect(w.topics()).toEqual(['Delivery (now)']);
  });
});
