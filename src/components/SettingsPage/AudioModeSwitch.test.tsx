// The audio page's mode switch (owner, 2026-11-15; B-03): the three modes beside the drawing, so how the sound goes in
// each can be seen without going back to the session's mode picker.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

import { AudioModeSwitch } from './AudioModeSwitch';
import useAudioStore from '../../stores/audioStore';

afterEach(() => { cleanup(); useAudioStore.setState({ mode: 'both' }); });

describe('the audio page mode switch', () => {
  it('offers the three modes, the current one pressed, and switches the mode', () => {
    useAudioStore.setState({ mode: 'speaker' });
    render(<AudioModeSwitch locked={false} />);
    const group = screen.getByRole('group', { name: 'Translation mode' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Me' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Other' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(useAudioStore.getState().mode).toBe('participant');
    fireEvent.click(screen.getByRole('button', { name: 'Both' }));
    expect(useAudioStore.getState().mode).toBe('both');
  });

  it('cannot switch during a session, and says so', () => {
    useAudioStore.setState({ mode: 'speaker' });
    render(<AudioModeSwitch locked />);
    expect(screen.getByRole('button', { name: 'Other' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(useAudioStore.getState().mode).toBe('speaker');
    expect(screen.getByText('Mode is locked during a session.')).toBeInTheDocument();
  });
});
