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
