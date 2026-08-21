import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MissingDeviceChip from './MissingDeviceChip';
import { MISSING_DEVICE_CHIP_HINT } from './missingDeviceChip';

// Same shape as SplitDegradedChip.test.tsx, plus {{...}} interpolation so the
// asserted text is the copy that actually ships rather than a key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string, v?: Record<string, string>) =>
      Object.entries(v ?? {}).reduce((s, [name, value]) => s.replace(`{{${name}}}`, value), d ?? _k),
  }),
}));

/**
 * The amber ring on the mode picker's warn segment is a colour-only signal:
 * nothing on screen says what is wrong, and the three existing explanations
 * (the segment's native title, the Start button's blocked reason, the device
 * popover) all require a hover or a click to reach. This chip is the resting
 * state of that answer, and it is a separate component because MainPanel has
 * no React harness in this repo — JSX inlined there is pinned by nothing.
 */
describe('MissingDeviceChip', () => {
  it('renders nothing at all when every in-scope channel has a device', () => {
    // The common case — it must add no footer chrome.
    const { container } = render(<MissingDeviceChip scope={null} onClick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the missing device in visible text, not just in colour', () => {
    render(<MissingDeviceChip scope="speaker" onClick={() => {}} />);
    expect(screen.getByText('Microphone not selected')).toBeInTheDocument();
  });

  it('explains the remedy on hover, via the title attribute', () => {
    render(<MissingDeviceChip scope="speaker" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute(
      'title',
      `Microphone not selected\n\n${MISSING_DEVICE_CHIP_HINT.defaultValue}`,
    );
  });

  it('keeps an accessible name even where the label text is hidden', () => {
    // The narrow-footer media query hides `.chip-text`, which would take the
    // accessible name with it — the same trap SplitDegradedChip guards against.
    render(<MissingDeviceChip scope="participant" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAccessibleName("Other's audio not selected");
  });

  it('hands its own element to the click handler so the popover can anchor to it', () => {
    // MainPanel anchors ModeDevicePopover to whatever was clicked, exactly as
    // it does for a mode-picker segment.
    const onClick = vi.fn();
    render(<MissingDeviceChip scope="speaker" onClick={onClick} />);
    const chip = screen.getByRole('button');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledWith(chip);
  });

  it('is a real button, so the explanation is reachable by keyboard', () => {
    // The gap this chip closes: a native `title` never appears on focus and
    // never appears on touch, so keyboard and touch users had no route to the
    // warn ring's meaning at all.
    render(<MissingDeviceChip scope="speaker" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});
