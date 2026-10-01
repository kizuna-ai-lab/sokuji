import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { DisplayItem } from '../../lib/view/filter';
import type { LegName } from '../../lib/conversation/types';
import { ConversationList, type ConversationListProps, type NoticeAction } from './ConversationList';

// A karaoke tick or a replay-state change should only re-render the rows and
// notices whose own props actually changed — RowBubble and NoticeBubble are
// memoized, so counting `useTranslation()` calls (both call it) counts renders.
const tally = vi.hoisted(() => ({ n: 0 }));

vi.mock('react-i18next', () => ({
  useTranslation: () => {
    tally.n += 1;
    return { t: (k: string, d?: string) => d ?? k };
  },
}));

// Forty segments: the first four are translation rows ending their segment on
// the 'speaker' leg (so they carry a replay slot); the rest are source rows
// (no slot, whatever `replaying` does). Plus one notice.
function makeItems(): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (let i = 0; i < 40; i++) {
    const segmentId = `s${i}`;
    const isSlot = i < 4;
    items.push({
      kind: 'row',
      row: { key: `${segmentId}:0`, segmentId, side: isSlot ? 'translation' : 'source', start: 0, end: 3, text: 'Hi.', final: true },
      leg: 'speaker',
      languages: { source: 'en', target: 'ja' },
      t: i,
      header: i === 0,
      endsSegment: true,
    });
  }
  items.push({ kind: 'notice', notice: { kind: 'notice', id: 'n0', leg: 'speaker', severity: 'warning', message: 'w', at: 999 } });
  return items;
}

const ITEMS = makeItems();

function baseProps(over: Partial<ConversationListProps> = {}): ConversationListProps {
  return {
    items: ITEMS,
    lit: new Map(),
    replaying: null,
    replayLegs: new Set<LegName>(['speaker']),
    // Fresh identities every call, as a real caller would hand them each render.
    canReplay: () => true,
    onReplay: () => {},
    compact: false,
    fontSize: 14,
    empty: 'Nothing yet',
    ...over,
  };
}

beforeEach(() => {
  tally.n = 0;
});

describe('ConversationList — memoized rows and notices', () => {
  it('a karaoke tick re-renders only the row it lights', () => {
    const { rerender } = render(<ConversationList {...baseProps()} />);
    const before = tally.n;
    rerender(<ConversationList {...baseProps({ lit: new Map([['s7', 3]]), canReplay: () => true, onReplay: () => {} })} />);
    expect(tally.n - before).toBe(1);
  });

  it('a new onReplay/canReplay identity alone re-renders no row', () => {
    const { rerender } = render(<ConversationList {...baseProps()} />);
    const before = tally.n;
    rerender(<ConversationList {...baseProps({ canReplay: () => true, onReplay: () => {} })} />);
    expect(tally.n - before).toBe(0);
  });

  it('replaying changing re-renders only the rows whose replay slot shows, none of the other 36', () => {
    const { rerender } = render(<ConversationList {...baseProps()} />);
    const before = tally.n;
    rerender(<ConversationList {...baseProps({ replaying: 's1', canReplay: () => true, onReplay: () => {} })} />);
    expect(tally.n - before).toBe(4);
  });

  it("caches a notice's action by id, so a fresh action object per call does not re-render the notice on a karaoke tick", () => {
    const noticeAction = (): NoticeAction => ({ label: 'Settings', run: () => {} });
    const { rerender } = render(<ConversationList {...baseProps({ noticeAction })} />);
    const before = tally.n;
    rerender(
      <ConversationList
        {...baseProps({ noticeAction, lit: new Map([['s7', 3]]), canReplay: () => true, onReplay: () => {} })}
      />,
    );
    // Only the row of s7 — the notice, despite a brand new action object, is not among them.
    expect(tally.n - before).toBe(1);
  });
});
