// The red notices of History's import panel lead into Settings — the panel closes first, then the
// settings page opens on the right category (and, for the line-up, scrolls to it and lights it for 3 seconds).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { createVirtualClock } from '../../lib/contract/clock';
import type { HistoryPort } from '../../lib/history/port';
import { createHistoryPageStore, type FileJobs } from '../../lib/history/historyPageStore';

vi.mock('../../app/useRun', () => ({ useSessionLocked: () => false }));

import '../../locales';
import { HistoryPageContext } from './historyContext';
import { ImportPanel } from './FileJobs';
import { SettingsPage } from '../SettingsPage/SettingsPage';
import { useSettingsStore } from '../../stores/settingsStore';

const port = {
  status: async () => ({ available: true, dir: '/h' }),
  listRecords: async () => [],
  usage: async () => ({ dbBytes: 0, audioBytes: 0, records: 0, binned: 0 }),
} as unknown as HistoryPort;

const jobsMissing = (missing: 'no-file-service' | 'hosted-soniox' | 'no-key'): FileJobs => ({
  service: vi.fn(async () => ({ missing })),
  sessionRunning: () => false,
  importFile: vi.fn(async () => undefined) as unknown as FileJobs['importFile'],
  transcribe: vi.fn(async () => undefined) as unknown as FileJobs['transcribe'],
  notesAfterImport: vi.fn(),
});

// The settings page's categories, stubbed: each draws the element its targets land on.
const bodies = {
  lineup: () => <div id="lineup-section">line-up</div>,
  accounts: () => <div id="provider-section">accounts</div>,
};

const file = new File([new Uint8Array(4)], 'Team sync.mp4', { type: 'video/mp4' });
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

/** The import panel over History, the settings page mounted beside it (as the layout keeps it), and what happened in order. */
async function scene(missing: 'no-file-service' | 'hosted-soniox' | 'no-key') {
  const events: string[] = [];
  const unsubscribe = useSettingsStore.subscribe((s, prev) => {
    if (s.settingsNavigationTarget !== prev.settingsNavigationTarget && s.settingsNavigationTarget) events.push(`navigate:${s.settingsNavigationTarget}`);
  });
  const store = createHistoryPageStore(port, createVirtualClock(0), () => 'x', null, jobsMissing(missing));
  store.getState().follow();
  let panelOpen = true;
  const onClose = vi.fn(() => { panelOpen = false; events.push('close'); });
  const view = render(
    <>
      <HistoryPageContext.Provider value={{ store, onClose: () => {} }}>
        <ImportPanel file={file} myLanguage="en" onClose={onClose} />
      </HistoryPageContext.Provider>
      <SettingsPage onClose={() => {}} bodies={bodies} />
    </>,
  );
  await settle();
  return { events, onClose, view, unsubscribe, isPanelOpen: () => panelOpen };
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  useSettingsStore.setState({ settingsNavigationTarget: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('from the History page red notices into Settings', () => {
  it('"key not filled in": closes the panel, then opens Accounts and keys at Soniox', async () => {
    const s = await scene('no-key');
    expect(screen.getByText('Your Soniox key is not filled in yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Accounts and keys' }));
    expect(s.events).toEqual(['close', 'navigate:provider:soniox']);
    expect(s.isPanelOpen()).toBe(false);
    expect(screen.getByRole('heading', { level: 2, name: 'Accounts and keys' })).toBeInTheDocument();
    s.unsubscribe();
  });

  for (const [missing, text] of [
    ['no-file-service', 'Files are transcribed only by Soniox with your own key. Choose it for transcription in the line-up.'],
    ['hosted-soniox', 'Files are transcribed only with your own Soniox key: Kizuna AI’s Soniox is for live sessions only, for now.'],
  ] as const) {
    it(`"${missing}": closes the panel, then opens Languages and line-up, scrolled to the line-up and lit for 3 seconds`, async () => {
      const s = await scene(missing);
      vi.useFakeTimers();
      const scrolled = vi.fn();
      (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrolled;
      expect(screen.getByText(text)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Open Languages and line-up' }));
      expect(s.events).toEqual(['close', 'navigate:lineup']);
      expect(screen.getByRole('heading', { level: 2, name: 'Languages and line-up' })).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(200); });
      const section = document.getElementById('lineup-section')!;
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toBe(section);
      expect(section).toHaveClass('highlight');
      act(() => { vi.advanceTimersByTime(2900); });
      expect(section).toHaveClass('highlight');
      act(() => { vi.advanceTimersByTime(200); });
      expect(section).not.toHaveClass('highlight');
      expect(useSettingsStore.getState().settingsNavigationTarget).toBeNull();
      delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      s.unsubscribe();
    });
  }
});
