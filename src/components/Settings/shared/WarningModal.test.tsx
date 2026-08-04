/**
 * Permission warnings and their deep link into System Settings (issue #335).
 *
 * Both macOS capture denials are invisible without this: screen recording
 * aborts the session with only a console line, and a denied audio tap yields
 * silence rather than an error.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WarningModal from './WarningModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

vi.mock('../../Modal/Modal', () => ({
  default: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
}));

const invoke = vi.fn();
beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ ok: true });
  (window as any).electron = { invoke };
});

describe('WarningModal permission types', () => {
  it('offers a deep link to the audio-capture pane', () => {
    render(<WarningModal isOpen={true} onClose={vi.fn()} type="audio-capture-denied" />);

    fireEvent.click(screen.getByText('Open System Settings'));

    expect(invoke).toHaveBeenCalledWith('open-privacy-settings', 'audio-capture');
  });

  it('offers a deep link to the screen-recording pane', () => {
    render(<WarningModal isOpen={true} onClose={vi.fn()} type="screen-recording-denied" />);

    fireEvent.click(screen.getByText('Open System Settings'));

    // Whole-system capture goes through screen capture, not a Core Audio tap.
    expect(invoke).toHaveBeenCalledWith('open-privacy-settings', 'screen-recording');
  });

  it('explains that macOS returns silence rather than an error', () => {
    render(<WarningModal isOpen={true} onClose={vi.fn()} type="audio-capture-denied" />);
    expect(screen.getByText(/silence instead of an error/i)).toBeInTheDocument();
  });

  it('tells the user why Sokuji was missing from the list until now', () => {
    render(<WarningModal isOpen={true} onClose={vi.fn()} type="audio-capture-denied" />);
    expect(screen.getByText(/only appears in that list after it has tried to capture once/i))
      .toBeInTheDocument();
  });

  it('shows no settings button for warnings that are not permissions', () => {
    render(<WarningModal isOpen={true} onClose={vi.fn()} type="virtual-mic" />);
    expect(screen.queryByText('Open System Settings')).toBeNull();
  });

  it('renders nothing without a type', () => {
    const { container } = render(<WarningModal isOpen={true} onClose={vi.fn()} type={null} />);
    expect(container.firstChild).toBeNull();
  });
});
