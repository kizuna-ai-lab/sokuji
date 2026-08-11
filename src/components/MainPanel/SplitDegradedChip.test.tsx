import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SplitDegradedChip from './SplitDegradedChip';
import { SPLIT_DEGRADED_DETAIL, SPLIT_DEGRADED_REASONS, SPLIT_DEGRADED_TOOLTIP } from './splitDegraded';

// Same shape as SubtitleIdle.test.tsx: resolve to the inline English default
// so what is asserted is the copy that actually ships, not a key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string) => d ?? _k,
  }),
}));

/**
 * The chip is a separate component rather than JSX inlined twice into
 * MainPanel for one reason: MainPanel has no React harness in this repo, so
 * anything left inline there is pinned by nothing. Extracted, the render is
 * covered here and MainPanel is left with one self-evident element per
 * footer.
 */
describe('SplitDegradedChip', () => {
  it('renders nothing at all when the split is not degraded', () => {
    // The overwhelmingly common case: every healthy session, every shared
    // Both session, every non-Soniox provider. It must add no footer chrome.
    const { container } = render(<SplitDegradedChip reason={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the persistent label when the split is degraded', () => {
    render(<SplitDegradedChip reason="loopback-denied" />);
    expect(screen.getByText('One-way only')).toBeInTheDocument();
  });

  it('explains the cause and the consequence on hover, via the title attribute', () => {
    // The title attribute is the same hover mechanism the footer's waveform
    // strips already use — no Tooltip dependency is pulled into the footer.
    render(<SplitDegradedChip reason="loopback-denied" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveAttribute(
      'title',
      SPLIT_DEGRADED_DETAIL['loopback-denied'].defaultValue + '\n\n' + SPLIT_DEGRADED_TOOLTIP.defaultValue
    );
  });

  it('renders a resolved cause line for every reason, not a raw key', () => {
    // Iterates the exported list rather than a hand-written one, so a reason
    // added later cannot ship without a render behind it.
    const titles = new Map(SPLIT_DEGRADED_REASONS.map(reason => {
      const { unmount } = render(<SplitDegradedChip reason={reason} />);
      const title = screen.getByRole('status').getAttribute('title');
      unmount();
      return [reason, title] as const;
    }));
    for (const [reason, title] of titles) {
      expect(title, `no cause line for ${reason}`).toBeTruthy();
      expect(title, `raw i18n key rendered for ${reason}`).not.toMatch(/^[a-zA-Z]+\.[a-zA-Z0-9]+$/);
    }
    // The permission case is the one with its own words; the other three
    // deliberately share a key, because what the user can do about them is
    // identical.
    expect(titles.get('loopback-denied')).toContain('Screen Recording permission');
    expect(titles.get('participant-stream-ended')).toContain('participant audio channel');
    expect(titles.get('loopback-denied')).not.toBe(titles.get('participant-stream-ended'));
  });

  it('keeps an accessible name even where the label text is hidden', () => {
    // The narrow-footer media query hides `.chip-text`, which would take the
    // label out of the accessibility tree with it. aria-label is what keeps
    // the chip announceable at every width.
    render(<SplitDegradedChip reason="participant-connect-failed" />);
    expect(screen.getByRole('status')).toHaveAccessibleName('One-way only');
  });
});
