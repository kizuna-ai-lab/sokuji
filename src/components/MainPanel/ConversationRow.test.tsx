import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ConversationItem } from '../../services/interfaces/IClient';
import ConversationRow from './ConversationRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

type RowItem = ConversationItem & { source?: 'speaker' | 'participant' };

function makeItem(over: Partial<RowItem>): RowItem {
  return {
    id: 'i1',
    role: 'user',
    type: 'message',
    status: 'completed',
    formatted: { text: 'hello' },
    source: 'speaker',
    createdAt: 1700000000000,
    ...over,
  } as RowItem;
}

const baseProps = {
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  isPlaying: false,
  highlightedChars: 0,
};

describe('ConversationRow — expanded (default) mode', () => {
  it('renders the row header when there is no previous item', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
      />,
    );
    expect(container.querySelector('.row-header')).not.toBeNull();
  });

  it('renders the lang-badge', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
      />,
    );
    expect(container.querySelector('.lang-badge')).not.toBeNull();
  });

  it('renders the row play button when canPlay is true', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        canPlay
        onPlay={() => {}}
      />,
    );
    expect(container.querySelector('.row-play-btn')).not.toBeNull();
  });

  it('does not render a role dot in expanded mode', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
      />,
    );
    expect(container.querySelector('.row-role-dot')).toBeNull();
  });

  it('tags the translation badge with source-speaker on speaker rows', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker', role: 'assistant' })}
        prevItem={null}
      />,
    );
    const badge = container.querySelector('.lang-badge.tr');
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('source-speaker')).toBe(true);
  });

  it('tags the translation badge with source-participant on participant rows', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'participant', role: 'assistant' })}
        prevItem={null}
      />,
    );
    const badge = container.querySelector('.lang-badge.tr');
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('source-participant')).toBe(true);
  });

  it('tags the source badge with source-<role> too (for future theming)', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'participant', role: 'user' })}
        prevItem={null}
      />,
    );
    const badge = container.querySelector('.lang-badge.src');
    expect(badge?.classList.contains('source-participant')).toBe(true);
  });
});

describe('ConversationRow — compact mode', () => {
  it('hides the row header', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        compact
      />,
    );
    expect(container.querySelector('.row-header')).toBeNull();
  });

  it('hides the lang-badge', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        compact
      />,
    );
    expect(container.querySelector('.lang-badge')).toBeNull();
  });

  it('hides the row play button even when canPlay is true', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        canPlay
        onPlay={() => {}}
        compact
      />,
    );
    expect(container.querySelector('.row-play-btn')).toBeNull();
  });

  it('renders a speaker-colored role dot on the first row of a speaker run', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        compact
      />,
    );
    const dot = container.querySelector('.row-role-dot');
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains('source-speaker')).toBe(true);
  });

  it('renders a participant-colored role dot on the first row of a participant run', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'participant' })}
        prevItem={makeItem({ source: 'speaker' })}
        compact
      />,
    );
    const dot = container.querySelector('.row-role-dot');
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains('source-participant')).toBe(true);
  });

  it('does NOT render a role dot when prevItem has the same source', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker', id: 'b' })}
        prevItem={makeItem({ source: 'speaker', id: 'a' })}
        compact
      />,
    );
    expect(container.querySelector('.row-role-dot')).toBeNull();
  });

  it('adds a compact class on the root element', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker' })}
        prevItem={null}
        compact
      />,
    );
    const root = container.querySelector('.conversation-row');
    expect(root?.classList.contains('compact')).toBe(true);
  });
});
