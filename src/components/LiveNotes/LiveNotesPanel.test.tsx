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
import { readLiveNotesLayout, useLiveNotesLayout } from '../../lib/notes/live/livePanel';

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
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); useLiveNotesLayout.setState({ layout: 'both' }); });

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

  // Owner, 2026-11-17: with live notes on, the panel is there before the session starts, saying where its notes will
  // come, and nothing more.
  it('before a session, with live notes on, shows its title and where the notes will come', () => {
    act(() => useLiveNotes.setState({ recordId: null, state: null, running: false, ended: false, off: false, hint: false }));
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    const panel = screen.getByRole('complementary', { name: 'Live notes' });
    expect(within(panel).getByText('Notes appear here as the conversation goes on.')).toBeInTheDocument();
    expect(within(panel).queryByRole('heading')).toBeNull();
  });

  it('is not there when live notes are off and nothing was written', () => {
    useSettingsStore.setState({ liveNotes: false } as never);
    act(() => useLiveNotes.setState({ recordId: null, state: null, running: false, ended: false, off: false, hint: false }));
    render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  // Owner, 2026-11-17 (B-30, B-40): the live notes can be hidden for a while from a switch in the conversation's toolbar
  // (PanelToolbar); the panel has no handle of its own, and hidden it leaves nothing beside the conversation.
  describe('hidden for a while', () => {
    const panel = () => screen.queryByRole('complementary', { name: 'Live notes' });

    it('has no handle of its own, and hidden it leaves nothing beside the conversation while the notes go on', () => {
      act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      expect(document.querySelector('.live-notes__handle')).toBeNull();
      expect(screen.queryByRole('button', { name: /live notes/i })).toBeNull();
      act(() => useLiveNotesLayout.getState().setLayout('conversation'));
      expect(panel()).toBeNull();
      expect(document.querySelector('.live-notes')).toHaveAttribute('hidden');
      // Hiding is not stopping: the loop runs and the setting is untouched.
      expect(useLiveNotes.getState().running).toBe(true);
      expect(useSettingsStore.getState().liveNotes).toBe(true);
      act(() => useLiveNotesLayout.getState().setLayout('both'));
      expect(panel()).not.toBeNull();
      expect(screen.getByRole('heading', { name: 'Supplier sync' })).toBeVisible();
    });

    it('stays hidden when new notes come in, and for the next session', () => {
      act(() => useLiveNotesLayout.getState().setLayout('conversation'));
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
      expect(panel()).toBeNull();
      expect(localStorage.getItem('liveNotes.layout')).toBe('conversation');
      expect(readLiveNotesLayout()).toBe('conversation');
    });

    // Review: a scroll that lands after the panel is hidden reads 0 from a box with no layout; it must not replace
    // where the reader was, which the panel goes back to when shown.
    it('goes back to where the reader was, whatever scroll comes while it is hidden', () => {
      act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      const body = document.querySelector('.live-notes__body') as HTMLElement;
      body.scrollTop = 300;
      fireEvent.scroll(body);
      act(() => useLiveNotesLayout.getState().setLayout('conversation'));
      body.scrollTop = 0;
      fireEvent.scroll(body);
      body.scrollTop = 0;
      act(() => useLiveNotesLayout.getState().setLayout('both'));
      expect(body.scrollTop).toBe(300);
    });

    it('hidden, leaves no divider beside the conversation either', () => {
      render(<div className="conversation-area"><div className="conversation-column" /><LiveNotesPanel onOpenHistory={vi.fn()} /></div>);
      expect(screen.getByRole('separator')).toBeInTheDocument();
      act(() => useLiveNotesLayout.getState().setLayout('conversation'));
      expect(screen.queryByRole('separator')).toBeNull();
    });

    // Owner, 2026-11-18: the switch also shows the notes alone in the conversation's area.
    it('alone, takes the area with no divider, and keeps where the reader was', () => {
      act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
      render(<div className="conversation-area"><div className="conversation-column" /><LiveNotesPanel onOpenHistory={vi.fn()} /></div>);
      const body = document.querySelector('.live-notes__body') as HTMLElement;
      body.scrollTop = 300;
      fireEvent.scroll(body);
      act(() => useLiveNotesLayout.getState().setLayout('notes'));
      expect(panel()).not.toBeNull();
      expect(panel()).toHaveClass('live-notes--alone');
      expect(screen.queryByRole('separator')).toBeNull();
      expect(body.scrollTop).toBe(300);
      act(() => useLiveNotesLayout.getState().setLayout('both'));
      expect(panel()).not.toHaveClass('live-notes--alone');
      expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('opens as it was left before there were three layouts: hidden, the conversation alone', () => {
      localStorage.setItem('liveNotes.hidden', '1');
      expect(readLiveNotesLayout()).toBe('conversation');
      localStorage.removeItem('liveNotes.hidden');
      expect(readLiveNotesLayout()).toBe('both');
      // Chosen once, the new layout is what is kept, and the old mark goes.
      localStorage.setItem('liveNotes.hidden', '1');
      act(() => useLiveNotesLayout.getState().setLayout('notes'));
      expect(localStorage.getItem('liveNotes.hidden')).toBeNull();
      expect(readLiveNotesLayout()).toBe('notes');
    });

    // Review: the panel stays up between sessions while live notes are on; a new session's notes start at the top,
    // not where the reader was in the last one.
    it('starts a new session\'s notes at the top, hidden in between or not', () => {
      act(() => useLiveNotes.getState().update('run-0001-aaaa', notes));
      render(<LiveNotesPanel onOpenHistory={vi.fn()} />);
      const body = document.querySelector('.live-notes__body') as HTMLElement;
      body.scrollTop = 300;
      fireEvent.scroll(body);
      act(() => useLiveNotesLayout.getState().setLayout('conversation'));
      act(() => { useLiveNotes.getState().end('run-0001-aaaa'); useLiveNotes.getState().begin('run-0002-bbbb'); useLiveNotes.getState().update('run-0002-bbbb', notes); });
      act(() => useLiveNotesLayout.getState().setLayout('both'));
      expect(body.scrollTop).toBe(0);
    });
  });
  // Owner, 2026-11-18: the panel's width can be dragged, at a divider on its left between it and the conversation, and
  // is kept for the next session (liveNotesWidth.ts).
  describe('its width', () => {
    /** The row's width, and what is told when it changes (the window resized, a side panel opened). */
    let rowWidth = 1400;
    let rowWatchers: Array<() => void> = [];
    /** The panel in the conversation's row, as MainLayout docks it, the row `row` px wide. */
    function renderInRow(row = 1400) {
      rowWidth = row;
      rowWatchers = [];
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('conversation-area') ? rowWidth : 0;
      });
      vi.stubGlobal('ResizeObserver', class {
        constructor(private readonly told: () => void) { rowWatchers.push(() => this.told()); }
        observe() {}
        disconnect() {}
      });
      return render(<div className="conversation-area"><div className="conversation-column" /><LiveNotesPanel onOpenHistory={vi.fn()} /></div>);
    }
    const resizeRow = (row: number) => { rowWidth = row; act(() => rowWatchers.forEach((tell) => tell())); };
    const pointer = (type: string, clientX: number, target: EventTarget = window) =>
      target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX, button: 0 }), { pointerType: 'mouse' }));
    const panelWidth = () => (document.querySelector('.live-notes') as HTMLElement).style.getPropertyValue('--live-notes-width');
    afterEach(() => vi.restoreAllMocks());

    it('has a divider on its left, between the conversation and the notes, at the width kept from last time', () => {
      localStorage.setItem('liveNotes.width', '400');
      const { container } = renderInRow();
      const row = container.querySelector('.conversation-area')!;
      expect([...row.children].map((c) => c.className)).toEqual(['conversation-column', 'panel-resizer', 'live-notes']);
      const divider = screen.getByRole('separator');
      expect(divider).toHaveAttribute('aria-valuenow', '400');
      expect(divider).toHaveAttribute('aria-valuemin', '240');
      expect(divider).toHaveAttribute('aria-valuemax', '840'); // 60% of 1400
      expect(panelWidth()).toBe('400px');
    });

    it('is 324px the first time', () => {
      renderInRow();
      expect(panelWidth()).toBe('324px');
    });

    it('moved at the divider, takes the new width and keeps it for the next session', () => {
      renderInRow();
      // The notes are on the divider's right: the arrow away from them widens them.
      fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
      expect(panelWidth()).toBe('340px');
      expect(localStorage.getItem('liveNotes.width')).toBe('340');
      fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
      expect(panelWidth()).toBe('324px');
      expect(localStorage.getItem('liveNotes.width')).toBe('324');
    });

    it('stops where the conversation keeps its 400px', () => {
      localStorage.setItem('liveNotes.width', '490');
      renderInRow(900);
      fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
      expect(panelWidth()).toBe('499px'); // 900 − 400 − the 1px divider
      expect(localStorage.getItem('liveNotes.width')).toBe('499');
    });

    it('shows a width kept from a wider window within a narrower one, and keeps the wider one', () => {
      localStorage.setItem('liveNotes.width', '700');
      renderInRow(1000);
      expect(panelWidth()).toBe('599px');
      expect(localStorage.getItem('liveNotes.width')).toBe('700');
    });

    // Review: a click on the divider, or an arrow key at the widest, changes nothing shown; it must not replace the
    // wider width kept from a wider window with the one this window allows.
    it('keeps the wider width when a click or a key at the limit changes nothing', () => {
      localStorage.setItem('liveNotes.width', '700');
      renderInRow(1000);
      const divider = screen.getByRole('separator');
      fireEvent.keyDown(divider, { key: 'ArrowLeft' });
      expect(panelWidth()).toBe('599px');
      expect(localStorage.getItem('liveNotes.width')).toBe('700');
      fireEvent.keyDown(divider, { key: 'ArrowRight' });
      expect(panelWidth()).toBe('583px');
      expect(localStorage.getItem('liveNotes.width')).toBe('583');
    });

    it('has a divider named after the live notes, so it is told apart from the Logs one', () => {
      renderInRow();
      expect(screen.getByRole('separator', { name: 'Resize live notes' })).toBeInTheDocument();
    });

    it('goes back to the width it had when a drag is cancelled, and keeps nothing of it', () => {
      localStorage.setItem('liveNotes.width', '400');
      renderInRow();
      const divider = screen.getByRole('separator');
      act(() => { pointer('pointerdown', 600, divider); pointer('pointermove', 500); });
      expect(panelWidth()).toBe('500px');
      act(() => { window.dispatchEvent(new Event('pointercancel')); });
      expect(panelWidth()).toBe('400px');
      expect(localStorage.getItem('liveNotes.width')).toBe('400');
    });

    it('drops a drag in progress when the panel goes away, and comes back at the width it had', () => {
      localStorage.setItem('liveNotes.width', '400');
      renderInRow();
      act(() => { pointer('pointerdown', 600, screen.getByRole('separator')); pointer('pointermove', 500); });
      expect(panelWidth()).toBe('500px');
      const before = useLiveNotes.getState();
      act(() => {
        useSettingsStore.setState({ liveNotes: false } as never);
        useLiveNotes.setState({ recordId: null, state: null, running: false, ended: false, off: false, hint: false });
      });
      expect(screen.queryByRole('separator')).toBeNull();
      act(() => { useSettingsStore.setState({ liveNotes: true } as never); useLiveNotes.setState(before); });
      expect(panelWidth()).toBe('400px');
    });

    it('keeps the width the row allows when the drag ends, if the row changed during it', () => {
      localStorage.setItem('liveNotes.width', '500');
      renderInRow(1000);
      const divider = screen.getByRole('separator');
      act(() => { pointer('pointerdown', 600, divider); pointer('pointermove', 500); });
      expect(panelWidth()).toBe('599px'); // the most a 1000px row allows
      resizeRow(1400);
      act(() => { pointer('pointerup', 400); });
      expect(panelWidth()).toBe('700px');
      expect(localStorage.getItem('liveNotes.width')).toBe('700');
    });

    it('keeps the width it was moved to for this session when it could not be saved', () => {
      localStorage.setItem('liveNotes.width', '700');
      renderInRow(1000);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
      const divider = screen.getByRole('separator');
      fireEvent.keyDown(divider, { key: 'ArrowRight' });
      expect(panelWidth()).toBe('583px');
      resizeRow(950);
      expect(panelWidth()).toBe('549px');
      fireEvent.keyDown(divider, { key: 'ArrowLeft' }); // at the most a 950px row allows: nothing changes
      resizeRow(1400);
      expect(panelWidth()).toBe('583px');
    });

    it('dragged and brought back to where it started, shows and keeps the width it had', () => {
      localStorage.setItem('liveNotes.width', '700');
      renderInRow(1000);
      const divider = screen.getByRole('separator');
      act(() => {
        divider.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, clientX: 400, button: 0 }), { pointerType: 'mouse' }));
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 450 }));
      });
      expect(panelWidth()).toBe('549px');
      act(() => {
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }));
        window.dispatchEvent(new MouseEvent('pointerup', { clientX: 400 }));
      });
      expect(panelWidth()).toBe('599px');
      expect(localStorage.getItem('liveNotes.width')).toBe('700');
    });
  });
});
