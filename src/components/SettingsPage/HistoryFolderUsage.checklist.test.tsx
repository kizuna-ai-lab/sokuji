// Checklist G11: History and notes — the folder, the space it takes, and the button that opens it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true,
}));
const history = vi.hoisted(() => ({
  status: { available: true, dir: '/Users/u/Library/Application Support/Sokuji/History' } as { available: boolean; reason?: 'newer' | 'error'; dir: string },
  usage: { dbBytes: 2_097_152, audioBytes: 524_288_000, records: 12, binned: 0 },
  usageCalls: 0,
}));
vi.mock('../../lib/history/port', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/history/port')>()),
  historyPort: () => ({ status: async () => history.status, usage: async () => { history.usageCalls += 1; return history.usage; } }),
}));

import '../../locales';
import { HistoryCategory } from './HistoryCategory';
import { useLineUpStore } from '../../stores/lineUpStore';

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const folderRow = () => screen.getByText('History folder', { selector: '.general-row__name' }).closest('.general-row') as HTMLElement;

beforeEach(() => {
  history.status = { available: true, dir: '/Users/u/Library/Application Support/Sokuji/History' };
  history.usageCalls = 0;
  useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' }, stored: true });
});
afterEach(() => { cleanup(); delete (window as unknown as { electron?: unknown }).electron; });

describe('G11 history folder and the space it takes', () => {
  it('counts the database and the recordings together, as the store measures them on disk', async () => {
    render(<HistoryCategory locked={false} />);
    await settle();
    // 2 MB of text + 500 MB of recordings.
    expect(within(folderRow()).getByText('502.0 MB in 12 records')).toBeInTheDocument();
  });

  it('opens the folder History is kept in, as the store reports it', async () => {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as { electron: unknown }).electron = { invoke };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(folderRow()).getByText(history.status.dir)).toBeInTheDocument();
    fireEvent.click(within(folderRow()).getByRole('button', { name: 'Open folder' }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('open-directory', history.status.dir);
  });

  it('offers no folder to open, and measures nothing, when History cannot be opened', async () => {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as { electron: unknown }).electron = { invoke };
    history.status = { available: false, reason: 'error', dir: '/somewhere' };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(folderRow()).getByRole('button', { name: 'Open folder' })).toBeDisabled();
    fireEvent.click(within(folderRow()).getByRole('button', { name: 'Open folder' }));
    expect(invoke).not.toHaveBeenCalled();
    expect(history.usageCalls).toBe(0);
    expect(within(folderRow()).getByText('History could not be opened.')).toBeInTheDocument();
  });
});
