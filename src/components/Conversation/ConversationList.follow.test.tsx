import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import type { DisplayItem } from '../../lib/view/filter';
import { ConversationList, type ConversationListProps } from './ConversationList';

// The key itself, so a test sees which catalog entry the row names.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const rows = (n: number): DisplayItem[] => Array.from({ length: n }, (_, i) => ({
  kind: 'row',
  row: { key: `s:speaker:${i}:0`, segmentId: `s:speaker:${i}`, side: 'translation', start: 0, end: 5, text: `line ${i}`, final: true },
  leg: 'speaker', languages: { source: 'en', target: 'ja' }, t: 0, header: i === 0, endsSegment: true,
}));
const props = (items: DisplayItem[]): ConversationListProps => ({
  items, lit: new Map(), replaying: null, replayLegs: new Set(), canReplay: () => false, onReplay: vi.fn(),
  compact: false, fontSize: 14, empty: 'Nothing yet',
});

/**
 * jsdom has no layout: the list's box is a stand-in, and scrollTop clamps to it
 * as a browser's does. A browser fires `scroll` after every move, so `moveTo`
 * and `update` do too.
 */
function mount() {
  let count = 20;
  const view = render(<ConversationList {...props(rows(count))} />);
  const el = view.container.querySelector('.conversation-display') as HTMLElement;
  const box = { height: 1000, client: 300, top: 0 };
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => box.height });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => box.client });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => box.top,
    set: (v: number) => { box.top = Math.max(0, Math.min(v, box.height - box.client)); },
  });
  el.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object' && options.top !== undefined) el.scrollTop = options.top;
  }) as typeof el.scrollTo;
  const moveTo = (top: number) => { el.scrollTop = top; fireEvent.scroll(el); };
  /** A new line arrives: the list grows to `height`. */
  const update = (height: number, items = rows(++count)) => {
    const before = box.top;
    box.height = height;
    view.rerender(<ConversationList {...props(items)} />);
    if (box.top !== before) fireEvent.scroll(el);
  };
  const wheelUp = () => fireEvent.wheel(el, { deltaY: -10 });
  const dock = () => view.container.querySelector('.follow-dock') as HTMLButtonElement | null;
  update(1000); // the list opens on its newest line
  return { view, el, box, moveTo, update, wheelUp, dock };
}

afterEach(() => { vi.useRealTimers(); });

describe('ConversationList — following the newest line', () => {
  it('keeps the newest line in view while the reader is at the bottom', () => {
    const { box, update } = mount();
    expect(box.top).toBe(700);
    update(1100);
    expect(box.top).toBe(800);
  });

  it('stops at once on a wheel up: the next line does not pull the reader back', () => {
    const { box, moveTo, update, wheelUp } = mount();
    wheelUp();
    moveTo(690);
    update(1100);
    expect(box.top).toBe(690);
  });

  it('cancels a pin still animating down when the reader wheels up', () => {
    const { el, wheelUp } = mount();
    wheelUp();
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 700, behavior: 'instant' });
  });

  it('does not resume when a line lands while the reader is moving up near the bottom', () => {
    const { box, moveTo, update, wheelUp } = mount();
    wheelUp();
    update(1020);   // a line lands mid-scroll
    moveTo(695);    // 25px from the bottom, but moving up
    update(1060);
    expect(box.top).toBe(695);
  });

  it('stops on a scroll up that came without a wheel (the scrollbar arrow, a key elsewhere)', () => {
    const { box, moveTo, update } = mount();
    moveTo(650);
    update(1100);
    expect(box.top).toBe(650);
  });

  it('resumes when the reader moves down into the last 48px', () => {
    const { box, moveTo, update, wheelUp } = mount();
    wheelUp();
    moveTo(400);
    moveTo(660);    // 40px from the bottom, moving down
    update(1100);
    expect(box.top).toBe(800);
  });

  // Scroll anchoring: a row above the visible ones grows (a translation landing on an
  // earlier segment) and the browser moves scrollTop down by as much, keeping the
  // distance to the bottom. Measured in Chromium: it fires `scroll`. Not the reader.
  it('does not resume when scroll anchoring moves the list down near the bottom', () => {
    const { box, el, moveTo, update, wheelUp } = mount();
    wheelUp();
    moveTo(670);                 // stopped 30px above the bottom
    box.height = 1020;           // a row above grows by 20px…
    box.top = 690;               // …and anchoring keeps the reader's line in place
    fireEvent.scroll(el);
    update(1060);
    expect(box.top).toBe(690);
  });

  it('resumes when the reader wheels down to the bottom while a line lands', () => {
    const { box, el, moveTo, update, wheelUp } = mount();
    wheelUp();
    moveTo(400);
    fireEvent.wheel(el, { deltaY: 10 });
    box.height = 1020;           // the box changed on the frame the reader arrived
    moveTo(700);
    update(1100);
    expect(box.top).toBe(800);
  });

  it('holds while the scrollbar is dragged, and lets the release decide', () => {
    const { el, box, moveTo, update } = mount();
    fireEvent.pointerDown(el);
    update(1100);
    expect(box.top).toBe(700);          // nothing pins while held
    moveTo(800);                        // dragged to the bottom
    fireEvent.pointerUp(window);
    update(1200);
    expect(box.top).toBe(900);          // released at the bottom: follows
  });

  it('stays stopped when the scrollbar is released away from the bottom', () => {
    const { el, box, moveTo, update } = mount();
    fireEvent.pointerDown(el);
    moveTo(300);
    fireEvent.pointerUp(window);
    update(1100);
    expect(box.top).toBe(300);
  });

  it('follows again once the list is emptied (Clear, a new run)', () => {
    const { box, moveTo, update, wheelUp } = mount();
    wheelUp();
    moveTo(300);
    update(0, []);
    update(1000);
    expect(box.top).toBe(700);
  });
});

describe('ConversationList — the Back to live row', () => {
  it('appears 250ms after following stops, not before, below the list', () => {
    vi.useFakeTimers();
    const { el, moveTo, wheelUp, dock } = mount();
    wheelUp();
    moveTo(600);
    act(() => { vi.advanceTimersByTime(249); });
    expect(dock()).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    // The panel's own words, not the audience page's (`viewer.backToLive`): a viewer copy
    // change, or the viewer dropping the key, must not reach the panel.
    expect(dock()?.textContent).toBe('mainPanel.backToLatest');
    expect(el.nextElementSibling).toBe(dock());   // docked after the list, not floating inside it
  });

  // A list that fits cannot move: a wheel up there is no reading back, and no scroll
  // event would ever resume following. Reported by CodeRabbit on #599.
  it('ignores upward input while the list is too short to scroll, and keeps following', () => {
    vi.useFakeTimers();
    const { el, box, update, dock } = mount();
    update(250);                                   // the conversation fits in the 300px box
    fireEvent.wheel(el, { deltaY: -10 });
    fireEvent.keyDown(el, { key: 'PageUp' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dock()).toBeNull();
    update(1000);                                  // it grows past the box: still on the newest line
    expect(box.top).toBe(700);
  });

  it('never shows for a nudge up and straight back', () => {
    vi.useFakeTimers();
    const { moveTo, wheelUp, dock } = mount();
    wheelUp();
    moveTo(690);
    moveTo(700);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dock()).toBeNull();
  });

  it('takes the reader back to the newest line and follows again when clicked', () => {
    vi.useFakeTimers();
    const { box, moveTo, update, wheelUp, dock } = mount();
    wheelUp();
    moveTo(200);
    act(() => { vi.advanceTimersByTime(250); });
    fireEvent.click(dock()!);
    expect(box.top).toBe(700);
    expect(dock()).toBeNull();
    update(1100);
    expect(box.top).toBe(800);
  });

  it('goes at once when the reader scrolls back to the bottom', () => {
    vi.useFakeTimers();
    const { moveTo, wheelUp, dock } = mount();
    wheelUp();
    moveTo(200);
    act(() => { vi.advanceTimersByTime(250); });
    expect(dock()).not.toBeNull();
    moveTo(700);
    expect(dock()).toBeNull();
  });
});
