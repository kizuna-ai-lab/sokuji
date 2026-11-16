// The live notes beside the conversation (desktop).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true,
}));
import '../../locales';
import { useLiveNotes } from '../../lib/notes/live/liveStore';
import type { LiveState } from '../../lib/notes/live/state';
import useSettingsStore from '../../stores/settingsStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import LiveNotesPanel from './LiveNotesPanel';

const notes: LiveState = {
  title: 'Supplier sync',
  topics: [
    { n: 1, title: 'Delivery', summary: 'd', points: [{ n: 1, text: 'Ships Tuesday', kinds: ['decision'] }, { n: 2, text: 'Send tracking', kinds: [], wasTodo: true }] },
    { n: 2, title: 'Packaging', summary: 'p', points: [{ n: 4, text: 'Customs may hold it', kinds: ['risk'] }] },
  ],
};

beforeEach(() => {
  useSettingsStore.setState({ liveNotes: true, notesAfterSession: false } as never);
  useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' } } as never);
  useLiveNotes.getState().begin('run-0001-aaaa');
});
afterEach(() => cleanup());

describe('the live notes panel', () => {
  it('shows the title, the topics in order with their points and kinds, the open one marked', () => {
    act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    const panel = screen.getByRole('complementary', { name: 'Live notes' });
    expect(within(panel).getByRole('heading', { name: 'Supplier sync' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Delivery', 'Packaging (now)']);
    expect(within(panel).getByText('Decision')).toBeInTheDocument();
    expect(within(panel).getByText('Risk')).toBeInTheDocument();
    // A withdrawn to-do is a plain point.
    const plain = within(panel).getByText('Send tracking').closest('li') as HTMLElement;
    expect(within(plain).queryByText('To do')).toBeNull();
  });

  it('says when it is waiting for the first notes, when updates fail, and when it was turned off', () => {
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.getByText('Notes appear here as the conversation goes on.')).toBeInTheDocument();
    act(() => useLiveNotes.getState().setHint('run-0001-aaaa', true));
    expect(screen.getByRole('status')).toHaveTextContent('Live notes could not be updated. They will try again.');
    act(() => useLiveNotes.getState().turnedOff('run-0001-aaaa'));
    expect(screen.getByText('Live notes are off.')).toBeInTheDocument();
  });

  // Review: until History answers, the panel cannot know whether the session is there, or whether notes are written.
  it('after Stop, says nothing of History until History has answered, then leads there', () => {
    const open = vi.fn();
    act(() => { useLiveNotes.getState().update('run-0001-aaaa', notes); useLiveNotes.getState().end('run-0001-aaaa'); });
    render(<LiveNotesPanel onOpenHistory={open} />);
    expect(screen.queryByRole('button', { name: 'Open History' })).toBeNull();
    expect(screen.queryByText(/History\./)).toBeNull();
    act(() => useLiveNotes.getState().closed('run-0001-aaaa', { kept: true, fullNotes: true }));
    expect(screen.getByText('The full notes will be in History.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open History' }));
    expect(open).toHaveBeenCalledWith('run-0001-aaaa');
    expect(screen.queryByText(/\(now\)/)).toBeNull();
  });

  // Review: the promise follows what was decided for this session, not the switch as it is now.
  it('after Stop, promises full notes only when they are being written for this session', () => {
    act(() => {
      useLiveNotes.getState().update('run-0001-aaaa', notes);
      useLiveNotes.getState().end('run-0001-aaaa');
      useLiveNotes.getState().closed('run-0001-aaaa', { kept: true, fullNotes: false });
    });
    useSettingsStore.setState({ notesAfterSession: true } as never);
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.queryByText('The full notes will be in History.')).toBeNull();
    expect(screen.getByText('Live notes are not kept. The session is in History.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open History' })).toBeInTheDocument();
  });

  // Review: History drops a session with nothing in it; the panel must not lead to it.
  it('after Stop, offers no way to History when History did not keep the session', () => {
    act(() => {
      useLiveNotes.getState().update('run-0001-aaaa', notes);
      useLiveNotes.getState().closed('run-0001-aaaa', { kept: false, fullNotes: false });
      useLiveNotes.getState().end('run-0001-aaaa');
    });
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.getByText('Live notes are not kept, and this session is not in History.')).toBeInTheDocument();
    expect(screen.queryByText('The full notes will be in History.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open History' })).toBeNull();
  });

  // Review: History gave up on the session and never closed it; the panel does not guess either way.
  it('after Stop, says only that live notes are not kept when History could not close the session', () => {
    act(() => {
      useLiveNotes.getState().update('run-0001-aaaa', notes);
      useLiveNotes.getState().end('run-0001-aaaa');
      useLiveNotes.getState().closed('run-0001-aaaa', { kept: null, fullNotes: false });
    });
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.getByText('Live notes are not kept.')).toBeInTheDocument();
    expect(screen.queryByText(/History/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open History' })).toBeNull();
  });

  it('is not there when live notes are off and nothing was written', () => {
    useSettingsStore.setState({ liveNotes: false } as never);
    act(() => useLiveNotes.setState({ recordId: null, state: null, running: false, ended: false, off: false, hint: false }));
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});
