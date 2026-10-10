import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Row } from '../../lib/projection/types';
import type { DisplayItem } from '../../lib/view/filter';
import { earsLegend, voicedEars } from '../MainPanel/useFaceToFace';
import { ConversationList, type ConversationListProps } from './ConversationList';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} }, // the stores earsLegend's module reads pull in the real i18n setup
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) =>
      typeof fallback === 'string'
        ? fallback
        : (fallback?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (m, name: string) => (fallback && name in fallback ? String(fallback[name]) : m)),
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

  it("names a labelled leg's person in the header, the number in the avatar", () => {
    const { container } = render(<ConversationList {...props({ items: [rowItem({ leg: 'participant', person: 2 })] })} />);
    expect(container.querySelector('.row-header .row-name-text')?.textContent).toBe('Speaker 2');
    expect(container.querySelector('.row-avatar.avatar-participant.person-shade-1 .row-avatar__number')?.textContent).toBe('2');
  });

  it('reads the person once: the avatar digit is decoration beside the name', () => {
    const { container } = render(<ConversationList {...props({ items: [rowItem({ leg: 'participant', person: 2 })] })} />);
    expect(container.querySelector('.row-avatar__number')?.getAttribute('aria-hidden')).toBe('true');
    // The accessible name stays: the header's own words.
    expect(container.querySelector('.row-name-text')?.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('cycles the avatar shade by person number', () => {
    const shade = (person: number) => {
      const { container } = render(<ConversationList {...props({ items: [rowItem({ person })] })} />);
      return container.querySelector('.row-avatar')?.className;
    };
    expect(shade(1)).toContain('person-shade-0');
    expect(shade(3)).toContain('person-shade-2');
    expect(shade(4)).toContain('person-shade-0');
  });

  it('keeps the leg name and its icon for a row with no person', () => {
    const { container } = render(<ConversationList {...props()} />);
    expect(container.querySelector('.row-header .row-name-text')?.textContent).toBe('Me');
    expect(container.querySelector('.row-avatar__number')).toBeNull();
  });

  it("names the person on the compact row's dot", () => {
    const { container } = render(<ConversationList {...props({ compact: true, items: [rowItem({ leg: 'participant', person: 3 })] })} />);
    expect(container.querySelector('.row-role-dot')?.getAttribute('aria-label')).toBe('Speaker 3');
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

  it("names the blocked reason in the button's aria-label too, not the plain replay label", () => {
    const { container } = render(<ConversationList {...props({ replayBlocked: 'Replay is off…' })} />);
    const button = container.querySelector('.row-play-btn') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Replay is off…');
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
    const buttons = container.querySelectorAll('.sys-row__action');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Settings');
    fireEvent.click(buttons[0]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('shows no action button when the caller gives none', () => {
    const { container } = render(<ConversationList {...props({ items: [{ kind: 'notice', notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'error', message: 'gone', at: 0 } } as DisplayItem] })} />);
    expect(container.querySelector('.sys-row__action')).toBeNull();
  });
});

describe('ConversationList — notices and the empty state', () => {
  it("draws a warning notice as a warning row, put into words", () => {
    const notice: DisplayItem = {
      kind: 'notice',
      notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'Invalid API key', code: 'leg_failed', at: 0 },
    };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.sys-row--warning')).not.toBeNull();
    expect(container.querySelector('.sys-row__text')?.textContent).toContain('The session stopped');
  });

  it('draws an error notice as an error row', () => {
    const notice: DisplayItem = { kind: 'notice', notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'error', message: 'gone', at: 0 } };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.sys-row--warning')).toBeNull();
    expect(container.querySelector('.sys-row--error')).not.toBeNull();
    expect(container.querySelector('.sys-row__text')?.textContent).toBe('gone');
  });

  it("falls back to today's Unknown error for a code-less notice with an empty message", () => {
    const notice: DisplayItem = { kind: 'notice', notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'error', message: '', at: 0 } };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.sys-row__text')?.textContent).toBe('Unknown error');
  });

  it('shows the empty state when there is nothing to draw', () => {
    const { container } = render(<ConversationList {...props({ items: [] })} />);
    expect(container.querySelector('.empty-state')?.textContent).toBe('Nothing yet');
    expect(container.querySelector('.conversation-list')).toBeNull();
  });

  it('draws an info notice as the neutral info row, not as an error', () => {
    const notice: DisplayItem = {
      kind: 'notice',
      notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'info', message: 'Now using the microphone "USB Mic".', code: 'mic_now_using', params: { device: 'USB Mic' }, at: 0 },
    };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.sys-row--info')).not.toBeNull();
    expect(container.querySelector('.sys-row--error')).toBeNull();
    expect(container.querySelector('.sys-row__text')?.textContent).toContain('Now using the microphone');
  });

  it('sets the font size on the display', () => {
    const { container } = render(<ConversationList {...props({ fontSize: 20 })} />);
    expect((container.querySelector('.conversation-display') as HTMLElement).style.getPropertyValue('--conversation-font-size')).toBe('20px');
  });
});

const noticeItem = (over: Partial<Extract<DisplayItem, { kind: 'notice' }>['notice']> = {}): DisplayItem => ({
  kind: 'notice',
  notice: { kind: 'notice', id: 'speaker:n:1', leg: 'speaker', severity: 'error', message: 'Session budget exhausted', code: 'budget_exhausted', at: 0, ...over },
});

describe('ConversationList — system rows (spec 2026-10-05 §2)', () => {
  it('draws a notice as a centred row: the severity on the icon and class, no header word, no bubble', () => {
    const { container } = render(<ConversationList {...props({ items: [noticeItem()] })} />);
    const row = container.querySelector('.sys-row');
    expect(row?.className).toBe('sys-row sys-row--error');
    expect(row?.querySelector('svg')).not.toBeNull();
    expect(row?.querySelector('.sys-row__text')?.textContent).toBe('Session budget exhausted');
    expect(container.querySelector('.message-bubble')).toBeNull();
    expect(container.querySelector('.message-header')).toBeNull();
  });

  it('tells the three severities apart by class alone', () => {
    const { container } = render(<ConversationList {...props({ items: [
      noticeItem({ id: 'a', severity: 'warning', code: 'tts_degraded', message: 'degraded' }),
      noticeItem({ id: 'b', severity: 'info', code: 'mic_now_using', message: 'now using', params: { device: 'USB Mic' } }),
    ] })} />);
    expect(container.querySelectorAll('.sys-row--warning')).toHaveLength(1);
    expect(container.querySelectorAll('.sys-row--info')).toHaveLength(1);
  });

  it('offers the caller’s action as an inline link after the words, and runs it', () => {
    const run = vi.fn();
    const { container } = render(<ConversationList {...props({
      items: [noticeItem({ severity: 'warning', code: 'voice_fallback', message: 'fallback' })],
      noticeAction: () => ({ label: 'Settings', run }),
    })} />);
    const link = container.querySelector('.sys-row__text .sys-row__action');
    expect(link?.textContent).toBe('Settings');
    fireEvent.click(link!);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('draws no link when the caller gives no action', () => {
    const { container } = render(<ConversationList {...props({ items: [noticeItem()], noticeAction: () => null })} />);
    expect(container.querySelector('.sys-row__action')).toBeNull();
  });
});

describe('ConversationList — face-to-face ears', () => {
  const ears = { speaker: 'right', participant: 'left' } as const;

  it('tags a spoken translation with the ear it played in, coloured by who heard it', () => {
    const { container } = render(<ConversationList {...props({ ears })} />);
    const tag = container.querySelector('.ear-tag');
    expect(tag?.classList.contains('ear-tag--right')).toBe(true);
    expect(tag?.classList.contains('listener-participant')).toBe(true);
    expect(tag?.textContent).toBe('R');
  });

  it("marks a translation outside the leg's target as not played, the reason on hover", () => {
    const own = rowItem({ row: row({ language: 'en' }) }); // the speaker leg's target is 'ja'
    const { container } = render(<ConversationList {...props({ ears, items: [own] })} />);
    const tag = container.querySelector('.ear-tag--muted');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe('');
    expect(tag?.getAttribute('title')).toMatch(/Not played/);
    expect(tag?.getAttribute('aria-label')).toMatch(/Not played/);
    expect(container.querySelector('.ear-tag--left, .ear-tag--right')).toBeNull();
  });

  it('offers no replay on a not-played translation, which never has audio; a played one and every row outside face-to-face keep theirs', () => {
    const own = rowItem({ row: row({ language: 'en' }) }); // the speaker leg's target is 'ja'
    const { container, rerender } = render(<ConversationList {...props({ ears, items: [own] })} />);
    expect(container.querySelector('.ear-tag--muted')).not.toBeNull();
    expect(container.querySelector('.row-play-btn')).toBeNull();
    rerender(<ConversationList {...props({ ears })} />);
    expect(container.querySelector('.ear-tag--right')).not.toBeNull();
    expect(container.querySelector('.row-play-btn')).not.toBeNull();
    rerender(<ConversationList {...props({ items: [own] })} />);
    expect(container.querySelector('.ear-tag')).toBeNull();
    expect(container.querySelector('.row-play-btn')).not.toBeNull();
  });

  it('compares app codes exactly, as the adapter does: a zh-Hant translation under a zh-Hans target is not played', () => {
    const variant = rowItem({ row: row({ language: 'zh-Hant' }), languages: { source: 'en', target: 'zh-Hans' } });
    const { container, rerender } = render(<ConversationList {...props({ ears, items: [variant] })} />);
    expect(container.querySelector('.ear-tag--muted')).not.toBeNull();
    expect(container.querySelector('.ear-tag--left, .ear-tag--right')).toBeNull();
    const same = rowItem({ row: row({ language: 'zh-Hans' }), languages: { source: 'en', target: 'zh-Hans' } });
    rerender(<ConversationList {...props({ ears, items: [same] })} />);
    expect(container.querySelector('.ear-tag--muted')).toBeNull();
    expect(container.querySelector('.ear-tag--right')).not.toBeNull();
  });

  it('draws no ear tag outside face-to-face, on a source row, or when compact', () => {
    const { container, rerender } = render(<ConversationList {...props()} />);
    expect(container.querySelector('.ear-tag')).toBeNull();
    rerender(<ConversationList {...props({ ears, items: [rowItem({ row: row({ side: 'source' }) })] })} />);
    expect(container.querySelector('.ear-tag')).toBeNull();
    rerender(<ConversationList {...props({ ears, compact: true })} />);
    expect(container.querySelector('.ear-tag')).toBeNull();
  });

  // A leg that never speaks (Kizuna Soniox's participant today): nothing on it plays, so nothing on it is "not played" either.
  it('draws neither an ear nor the not-played mark on a leg the ears leave out', () => {
    const theirs = rowItem({ leg: 'participant', languages: { source: 'ja', target: 'en' }, row: row({ language: 'en' }) });
    const codeSwitched = rowItem({ leg: 'participant', languages: { source: 'ja', target: 'en' }, row: row({ key: 'k2', language: 'ja' }) });
    const { container } = render(<ConversationList {...props({ ears: { speaker: 'right' }, items: [theirs, codeSwitched], replayLegs: new Set(['speaker']) })} />);
    expect(container.querySelectorAll('.conversation-row')).toHaveLength(2);
    expect(container.querySelector('.ear-tag')).toBeNull();
    expect(container.querySelector('.row-play-btn')).toBeNull();
    // The voiced leg keeps its ear.
    const { container: mine } = render(<ConversationList {...props({ ears: { speaker: 'right' } })} />);
    expect(mine.querySelector('.ear-tag--right')).not.toBeNull();
  });

  it("keeps the not-played mark on a voiced leg whose outlet is centred, and draws no letter on a played line", () => {
    const centred = { speaker: 'centre', participant: 'centre' } as const;
    const codeSwitched = rowItem({ leg: 'participant', languages: { source: 'ja', target: 'en' }, row: row({ language: 'ja' }) });
    const { container, rerender } = render(<ConversationList {...props({ ears: centred, items: [codeSwitched], replayLegs: new Set(['participant']) })} />);
    expect(container.querySelector('.ear-tag--muted')).not.toBeNull();
    expect(container.querySelector('.row-play-btn')).toBeNull();
    const normal = rowItem({ leg: 'participant', languages: { source: 'ja', target: 'en' }, row: row({ language: 'en' }) });
    rerender(<ConversationList {...props({ ears: centred, items: [normal], replayLegs: new Set(['participant']) })} />);
    expect(container.querySelector('.ear-tag')).toBeNull();
    expect(container.querySelector('.row-play-btn')).not.toBeNull();
  });

  it('shares one source of truth with the footer legend: the participant leg is my ear', () => {
    for (const swap of [false, true]) {
      const view = { offered: true, active: true, me: 'ja', other: 'en', ears: (swap ? { speaker: 'left', participant: 'right' } : { speaker: 'right', participant: 'left' }) as Record<'speaker' | 'participant', 'left' | 'right'>, speaks: { speaker: true, participant: true }, outletDevices: { other: null, them: null } };
      const legend = earsLegend(view)!;
      const myEar = legend.find((e) => e.who === 'me')!.ear;
      const item = rowItem({ leg: 'participant', languages: { source: 'en', target: 'ja' } });
      const { container } = render(<ConversationList {...props({ ears: voicedEars(view), items: [item], replayLegs: new Set() })} />);
      const tag = container.querySelector('.ear-tag');
      expect(tag?.classList.contains(`ear-tag--${myEar}`)).toBe(true);
      expect(myEar).toBe(swap ? 'right' : 'left');
    }
  });
});
