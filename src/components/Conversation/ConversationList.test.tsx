import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Row } from '../../lib/projection/types';
import type { DisplayItem } from '../../lib/view/filter';
import { ConversationList, type ConversationListProps } from './ConversationList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

const TEXT = 'こんにちは、お元気ですか？';
const row = (over: Partial<Row> = {}): Row => ({
  key: 's:speaker:2:0', segmentId: 's:speaker:2', side: 'translation', start: 0, end: TEXT.length, text: TEXT, final: true, ...over,
});
const rowItem = (over: Partial<Extract<DisplayItem, { kind: 'row' }>> = {}): DisplayItem => ({
  kind: 'row', row: row(), leg: 'speaker', languages: { source: 'en', target: 'ja' }, t: 0, header: true, endsSegment: true, ...over,
});
const props = (over: Partial<ConversationListProps> = {}): ConversationListProps => ({
  items: [rowItem()],
  lit: new Map(),
  replaying: null,
  replayLegs: new Set(['speaker']),
  canReplay: () => true,
  onReplay: vi.fn(),
  compact: false,
  fontSize: 14,
  empty: 'Nothing yet',
  ...over,
});

describe('ConversationList — rows', () => {
  it("draws a row with today's bubble markup: header, badge and text", () => {
    const { container } = render(<ConversationList {...props()} />);
    expect(container.querySelector('.conversation-row.source-speaker.with-header.expanded')).not.toBeNull();
    expect(container.querySelector('.row-header .row-name-text')?.textContent).toBe('Me');
    expect(container.querySelector('.lang-badge.tr.source-speaker')?.textContent).toBe('JA');
    expect(container.querySelector('.row-text.tr')?.textContent).toBe(TEXT);
  });

  it("takes a detected language over the leg's pair, and the source side's language on a source row", () => {
    const { container, rerender } = render(<ConversationList {...props({ items: [rowItem({ row: row({ language: 'zh' }) })] })} />);
    expect(container.querySelector('.lang-badge')?.textContent).toBe('ZH');
    rerender(<ConversationList {...props({ items: [rowItem({ row: row({ side: 'source' }) })] })} />);
    expect(container.querySelector('.lang-badge.src')?.textContent).toBe('EN');
  });

  it('draws a grouped row without a header, and a dot instead of header and badge when compact', () => {
    const { container, rerender } = render(<ConversationList {...props({ items: [rowItem({ header: false })] })} />);
    expect(container.querySelector('.conversation-row.grouped')).not.toBeNull();
    expect(container.querySelector('.row-header')).toBeNull();
    rerender(<ConversationList {...props({ compact: true })} />);
    expect(container.querySelector('.row-role-dot.source-speaker')).not.toBeNull();
    expect(container.querySelector('.lang-badge')).toBeNull();
  });

  it('lights the spoken characters and marks the row as playing', () => {
    const { container } = render(<ConversationList {...props({ lit: new Map([['s:speaker:2', 6]]) })} />);
    expect(container.querySelector('.karaoke-played')?.textContent).toBe('こんにちは、');
    expect(container.querySelector('.row-body.playing')).not.toBeNull();
  });

  it("tints only the row that holds the karaoke boundary, not every row of a multi-row segment", () => {
    const items: DisplayItem[] = [
      rowItem({ row: row({ key: 's:speaker:1:0', segmentId: 's:speaker:1', start: 0, end: 4, text: 'One.' }), header: true, endsSegment: false }),
      rowItem({ row: row({ key: 's:speaker:1:1', segmentId: 's:speaker:1', start: 4, end: 9, text: ' Two.' }), header: false, endsSegment: true }),
    ];
    const { container } = render(<ConversationList {...props({ items, lit: new Map([['s:speaker:1', 6]]) })} />);
    const bodies = [...container.querySelectorAll('.row-body')];
    expect(bodies).toHaveLength(2);
    expect(bodies[0].classList.contains('playing')).toBe(false);
    expect(bodies[1].classList.contains('playing')).toBe(true);
    // The whole first row is still lit; karaoke has passed it.
    expect(bodies[0].querySelector('.karaoke-played')?.textContent).toBe('One.');
  });

  it("tints a segment's last drawn row once karaoke has passed its end", () => {
    const item = rowItem({ row: row({ key: 's:speaker:1:0', segmentId: 's:speaker:1', start: 0, end: 4, text: 'One.' }), endsSegment: true });
    const { container } = render(<ConversationList {...props({ items: [item], lit: new Map([['s:speaker:1', 9]]) })} />);
    expect(container.querySelector('.row-body.playing')).not.toBeNull();
  });

  it('trims a row for display and keeps karaoke on the trimmed text', () => {
    const item = rowItem({ row: row({ key: 's:speaker:1:1', segmentId: 's:speaker:1', side: 'source', start: 4, end: 9, text: ' Two.' }) });
    const { container } = render(<ConversationList {...props({ items: [item], lit: new Map([['s:speaker:1', 6]]) })} />);
    expect(container.querySelector('.row-text')?.textContent).toBe('Two.');
    expect(container.querySelector('.karaoke-played')?.textContent).toBe('T');
  });
});

describe('ConversationList — replay', () => {
  it("offers replay on a translation segment's last row, and replays that segment", () => {
    const onReplay = vi.fn();
    const { container } = render(<ConversationList {...props({ onReplay })} />);
    const button = container.querySelector('.row-play-btn') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onReplay).toHaveBeenCalledWith('speaker', 's:speaker:2');
  });

  it('disables the button while another segment replays, and where no pcm was kept', () => {
    const { container, rerender } = render(<ConversationList {...props({ replaying: 's:speaker:9' })} />);
    expect((container.querySelector('.row-play-btn') as HTMLButtonElement).disabled).toBe(true);
    rerender(<ConversationList {...props({ canReplay: () => false })} />);
    expect((container.querySelector('.row-play-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no replay slot on a source row, a row that does not end its segment, a leg without replay, or a compact list', () => {
    for (const p of [
      props({ items: [rowItem({ row: row({ side: 'source' }) })] }),
      props({ items: [rowItem({ endsSegment: false })] }),
      props({ replayLegs: new Set() }),
      props({ compact: true }),
    ]) {
      const { container, unmount } = render(<ConversationList {...p} />);
      expect(container.querySelector('.row-play-btn')).toBeNull();
      unmount();
    }
  });
});

describe('ConversationList — replay gate', () => {
  it('disables every replay slot and sets its title while replay is blocked', () => {
    const { container } = render(<ConversationList {...props({ replayBlocked: 'Replay is off…' })} />);
    const button = container.querySelector('.row-play-btn') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Replay is off…');
  });

  it('leaves the existing enabled/disabled cases when not blocked', () => {
    const { container } = render(<ConversationList {...props()} />);
    const button = container.querySelector('.row-play-btn') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.title).toBe("Play this item's audio");

    const { container: disabledContainer } = render(<ConversationList {...props({ replaying: 's:speaker:9' })} />);
    expect((disabledContainer.querySelector('.row-play-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ConversationList — a notice action', () => {
  it("shows a notice's action button, labelled by the caller, and runs it on click", () => {
    const run = vi.fn();
    const target: DisplayItem = {
      kind: 'notice',
      notice: { kind: 'notice', id: 'n1', leg: 'speaker', severity: 'warning', message: 'w', code: 'no_microphone', at: 0 },
    };
    const other: DisplayItem = {
      kind: 'notice',
      notice: { kind: 'notice', id: 'n2', leg: 'speaker', severity: 'warning', message: 'w2', code: 'start_failed', at: 0 },
    };
    const { container } = render(
      <ConversationList
        {...props({
          items: [target, other],
          noticeAction: (n) => (n.code === 'no_microphone' ? { label: 'Settings', run } : null),
        })}
      />,
    );
    const buttons = container.querySelectorAll('.message-action');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Settings');
    fireEvent.click(buttons[0]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('shows no action button when the caller gives none', () => {
    const { container } = render(<ConversationList {...props({ items: [{ kind: 'notice', notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'error', message: 'gone', at: 0 } } as DisplayItem] })} />);
    expect(container.querySelector('.message-action')).toBeNull();
  });
});

describe('ConversationList — notices and the empty state', () => {
  it("draws a notice as today's error bubble, labelled by its severity and put into words", () => {
    const notice: DisplayItem = {
      kind: 'notice',
      notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'Invalid API key', code: 'leg_failed', at: 0 },
    };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.message-bubble.error.warning')).not.toBeNull();
    expect(container.querySelector('.message-header')?.textContent).toBe('Warning');
    expect(container.querySelector('.message-content.error-content')?.textContent).toContain('The session stopped');
  });

  it('labels an error notice as an error', () => {
    const notice: DisplayItem = { kind: 'notice', notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'error', message: 'gone', at: 0 } };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.message-bubble.error.warning')).toBeNull();
    expect(container.querySelector('.message-header')?.textContent).toBe('Error');
    expect(container.querySelector('.message-content')?.textContent).toBe('gone');
  });

  it("falls back to today's Unknown error for a code-less notice with an empty message", () => {
    const notice: DisplayItem = { kind: 'notice', notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'error', message: '', at: 0 } };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.message-content')?.textContent).toBe('Unknown error');
  });

  it('shows the empty state when there is nothing to draw', () => {
    const { container } = render(<ConversationList {...props({ items: [] })} />);
    expect(container.querySelector('.empty-state')?.textContent).toBe('Nothing yet');
    expect(container.querySelector('.conversation-list')).toBeNull();
  });

  it('sets the font size on the display', () => {
    const { container } = render(<ConversationList {...props({ fontSize: 20 })} />);
    expect((container.querySelector('.conversation-display') as HTMLElement).style.getPropertyValue('--conversation-font-size')).toBe('20px');
  });
});
