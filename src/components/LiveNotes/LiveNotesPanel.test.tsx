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

const notesPricing = vi.hoisted(() => ({ value: { inputPerMTok: 0.2, cachedInputPerMTok: 0.02, outputPerMTok: 1, liveUsdPerHour: 0.04, afterSessionUsdPerHour: 0.012 } as null | Record<string, number> }));
vi.mock('../../lib/notes/notesPricing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notes/notesPricing')>()),
  useNotesPricing: () => notesPricing.value,
}));

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
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

describe('the live notes panel', () => {
  it('with Kizuna AI, shows what the live notes have used so far, and says when the balance is low', () => {
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'kizunaai' } } as never);
    act(() => {
      // 1000 × 0.2 + 8000 × 0.02 + 3000 × 1 per million: $0.00336.
      useLiveNotes.getState().addUsage('run-0001-aaaa', { prompt_tokens: 9000, completion_tokens: 3000, prompt_tokens_details: { cached_tokens: 8000 } });
    });
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.getByText('Live notes so far: about $0.003')).toBeInTheDocument();
    expect(screen.queryByText(/balance is low/)).toBeNull();
    act(() => useLiveNotes.getState().balanceAfter('run-0001-aaaa', 80_000));
    expect(screen.getByText('Your balance is low: $0.08 left.')).toBeInTheDocument();
  });

  it('shows no cost with an own key', () => {
    act(() => useLiveNotes.getState().addUsage('run-0001-aaaa', { prompt_tokens: 9000, completion_tokens: 3000 }));
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.queryByText(/Live notes so far/)).toBeNull();
  });

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

  it('says the balance ran out when Kizuna AI stopped the live notes for it, and another reason in general words', () => {
    act(() => useLiveNotes.getState().stoppedFor('run-0001-aaaa', 'no-balance'));
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.getByText('Your balance ran out; live notes stopped.')).toBeInTheDocument();
    act(() => { useLiveNotes.getState().begin('run-0001-aaaa'); useLiveNotes.getState().stoppedFor('run-0001-aaaa', 'daily-limit'); });
    expect(screen.getByText('Kizuna AI cannot write live notes right now; they stopped.')).toBeInTheDocument();
    expect(useLiveNotes.getState().running).toBe(false);
  });

  it('is not there when live notes are off and nothing was written', () => {
    useSettingsStore.setState({ liveNotes: false } as never);
    act(() => useLiveNotes.setState({ recordId: null, state: null, running: false, ended: false, off: false, hint: false }));
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  // Owner, 2026-11-17 (B-30): the live notes can be hidden for a while, from a handle of their own; they go on being written.
  describe('hiding them for a while', () => {
    /** A window narrow enough for the notes to sit above the conversation. */
    const narrowWindow = () => vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767px)', media: query, addEventListener: () => {}, removeEventListener: () => {},
    }));
    const body = () => document.querySelector('.live-notes__body') as HTMLElement;

    it('hides them from a handle, says they are still being written, and shows them again', () => {
      act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      const hide = screen.getByRole('button', { name: 'Hide live notes' });
      expect(hide).toHaveAttribute('title', 'Hide live notes');
      expect(hide).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(hide);
      expect(body()).toHaveAttribute('hidden');
      expect(screen.getByRole('complementary', { name: 'Live notes' }).className).toContain('is-hidden');
      const show = screen.getByRole('button', { name: 'Show live notes (still being written)' });
      expect(show).toHaveAttribute('title', 'Show live notes (still being written)');
      expect(show).toHaveAttribute('aria-expanded', 'false');
      // Hiding is not stopping: the loop runs and the setting is untouched.
      expect(useLiveNotes.getState().running).toBe(true);
      expect(useSettingsStore.getState().liveNotes).toBe(true);
      fireEvent.click(show);
      expect(body()).not.toHaveAttribute('hidden');
      expect(screen.getByRole('heading', { name: 'Supplier sync' })).toBeVisible();
    });

    it('stays hidden when new notes come in, and for the next session', () => {
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide live notes' }));
      act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
      expect(body()).toHaveAttribute('hidden');
      expect(localStorage.getItem('liveNotes.hidden')).toBe('1');
      cleanup();
      act(() => useLiveNotes.getState().begin('run-0002-bbbb'));
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      expect(body()).toHaveAttribute('hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Show live notes (still being written)' }));
      expect(localStorage.getItem('liveNotes.hidden')).toBeNull();
    });

    it('once the session has ended, offers to show them without saying they are being written', () => {
      act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
      act(() => useLiveNotes.getState().end('run-0001-aaaa'));
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide live notes' }));
      expect(screen.getByRole('button', { name: 'Show live notes' })).toBeInTheDocument();
    });

    it('points its arrows the way the notes go: to the right edge in a wide window, up in a narrow one', () => {
      const { unmount } = render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      const icon = () => screen.getByRole('button', { name: /live notes/ }).querySelector('svg')!.getAttribute('class');
      expect(icon()).toContain('lucide-chevrons-right');
      fireEvent.click(screen.getByRole('button', { name: 'Hide live notes' }));
      expect(icon()).toContain('lucide-chevrons-left');
      unmount();
      localStorage.clear();
      narrowWindow();
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      expect(icon()).toContain('lucide-chevrons-up');
      fireEvent.click(screen.getByRole('button', { name: 'Hide live notes' }));
      expect(icon()).toContain('lucide-chevrons-down');
    });
  });
});
