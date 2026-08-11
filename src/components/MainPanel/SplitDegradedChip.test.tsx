import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SplitDegradedChip from './SplitDegradedChip';
import { SPLIT_DEGRADED_DETAIL, SPLIT_DEGRADED_TOOLTIP, type SplitDegradedReason } from './splitDegraded';

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

  it('gives a different cause line for each reason', () => {
    const titles = (['loopback-denied', 'no-participant-config', 'participant-connect-failed'] as SplitDegradedReason[])
      .map(reason => {
        const { unmount } = render(<SplitDegradedChip reason={reason} />);
        const title = screen.getByRole('status').getAttribute('title');
        unmount();
        return title;
      });
    expect(titles[0]).toContain('Screen Recording permission');
    expect(titles[1]).toContain('participant audio channel');
    expect(titles[0]).not.toBe(titles[1]);
  });

  it('keeps an accessible name even where the label text is hidden', () => {
    // The narrow-footer media query hides `.chip-text`, which would take the
    // label out of the accessibility tree with it. aria-label is what keeps
    // the chip announceable at every width.
    render(<SplitDegradedChip reason="participant-connect-failed" />);
    expect(screen.getByRole('status')).toHaveAccessibleName('One-way only');
  });
});
