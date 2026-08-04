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
  useTranslation: () => ({
    // Resolve {{app}} the way i18next would, so the tests see the real text.
    t: (key: string, def?: string, opts?: Record<string, string>) =>
      Object.entries(opts ?? {}).reduce(
        (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
        def ?? key
      ),
  }),
}));

vi.mock('../../Modal/Modal', () => ({
  default: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
}));

const invoke = vi.fn();
beforeEach(() => {
  invoke.mockReset().mockImplementation(async (channel: string) =>
    channel === 'get-tcc-display-name' ? { name: 'Sokuji', isDev: false } : { ok: true }
  );
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

  it('tells the user why the app was missing from the list until now', () => {
    render(<WarningModal isOpen={true} onClose={vi.fn()} type="audio-capture-denied" />);
    expect(screen.getByText(/only appears in that list after it has tried to capture once/i))
      .toBeInTheDocument();
  });

  it('names the bundle macOS actually lists, which in dev is Electron', async () => {
    // `npm run dev` runs Electron's own bundle, so telling the developer to
    // enable "Sokuji" sends them looking for an entry that does not exist.
    invoke.mockImplementation(async (channel: string) =>
      channel === 'get-tcc-display-name' ? { name: 'Electron', isDev: true } : { ok: true }
    );

    render(<WarningModal isOpen={true} onClose={vi.fn()} type="audio-capture-denied" />);

    expect(await screen.findByText(/enable "Electron"/)).toBeInTheDocument();
  });

  it('falls back to Sokuji when the name cannot be fetched', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'get-tcc-display-name') throw new Error('no ipc');
      return { ok: true };
    });

    render(<WarningModal isOpen={true} onClose={vi.fn()} type="audio-capture-denied" />);

    expect(await screen.findByText(/enable "Sokuji"/)).toBeInTheDocument();
  });

  it('shows no settings button for warnings that are not permissions', () => {
    render(<WarningModal isOpen={true} onClose={vi.fn()} type="virtual-mic" />);
    expect(screen.queryByText('Open System Settings')).toBeNull();
  });

  it('renders an alternative-path note when one is offered', () => {
    render(
      <WarningModal
        isOpen={true}
        onClose={vi.fn()}
        type="screen-recording-denied"
        note="Pick a specific application instead."
      />
    );
    // A denied permission with a working alternative must not read as a dead end.
    expect(screen.getByText('Pick a specific application instead.')).toBeInTheDocument();
  });

  it('renders no note when none is passed', () => {
    const { container } = render(
      <WarningModal isOpen={true} onClose={vi.fn()} type="screen-recording-denied" />
    );
    expect(container.querySelector('.warning-note')).toBeNull();
  });

  it('renders nothing without a type', () => {
    const { container } = render(<WarningModal isOpen={true} onClose={vi.fn()} type={null} />);
    expect(container.firstChild).toBeNull();
  });
});
