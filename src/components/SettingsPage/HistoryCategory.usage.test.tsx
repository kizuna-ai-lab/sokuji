// Settings › History and notes, the folder and the space it takes, after a record is deleted.
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
  status: { available: true, dir: '/home/u/.config/sokuji/history' } as { available: boolean; reason?: 'newer' | 'error'; dir: string },
  usage: { dbBytes: 0, audioBytes: 0, records: 0, binned: 0 },
  usageCalls: 0,
}));
vi.mock('../../lib/history/port', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/history/port')>()),
  historyPort: () => ({
    status: async () => history.status,
    usage: async () => { history.usageCalls += 1; return history.usage; },
  }),
}));

import '../../locales';
import { HistoryCategory } from './HistoryCategory';
import { useLineUpStore } from '../../stores/lineUpStore';

const MB = 1024 * 1024;
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const folderRow = () => screen.getByText('History folder', { selector: '.general-row__name' }).closest('.general-row') as HTMLElement;

beforeEach(() => {
  history.status = { available: true, dir: '/home/u/.config/sokuji/history' };
  history.usageCalls = 0;
  useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' }, stored: true });
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('Settings › History and notes: folder and usage', () => {
  it('shows the database and the recordings together as the space History takes', async () => {
    history.usage = { dbBytes: 1 * MB, audioBytes: 2.5 * MB, records: 7, binned: 0 };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(folderRow()).getByText('3.5 MB in 7 records')).toBeInTheDocument();
  });

  it('says "record" for a single one', async () => {
    history.usage = { dbBytes: 200 * 1024, audioBytes: 0, records: 1, binned: 0 };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(folderRow()).getByText('200.0 KB in 1 record')).toBeInTheDocument();
  });

  it('reads the space afresh each time the page opens: after a record with a recording is deleted for good it is smaller', async () => {
    history.usage = { dbBytes: 1 * MB, audioBytes: 3 * MB, records: 2, binned: 0 };
    const first = render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(folderRow()).getByText('4.0 MB in 2 records')).toBeInTheDocument();
    first.unmount();

    // The record and its 3 MB recording are gone from the disk (History page: bin, then delete for good).
    history.usage = { dbBytes: 1 * MB, audioBytes: 0, records: 1, binned: 0 };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(folderRow()).getByText('1.0 MB in 1 record')).toBeInTheDocument();
    expect(history.usageCalls).toBe(2);
  });

  it('opens exactly the folder History reports, not a guessed one', async () => {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as { electron: unknown }).electron = { invoke };
    history.usage = { dbBytes: MB, audioBytes: 0, records: 1, binned: 0 };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(folderRow()).getByText('/home/u/.config/sokuji/history')).toBeInTheDocument();
    fireEvent.click(within(folderRow()).getByRole('button', { name: 'Open folder' }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('open-directory', '/home/u/.config/sokuji/history');
  });

  it('while History cannot be opened, shows no size and the Open folder button does nothing', async () => {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as { electron: unknown }).electron = { invoke };
    history.status = { available: false, reason: 'error', dir: '/home/u/.config/sokuji/history' };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(folderRow()).getByText('History could not be opened.')).toBeInTheDocument();
    expect(within(folderRow()).queryByText(/ in \d+ records?$/)).toBeNull();
    expect(history.usageCalls).toBe(0);
    const button = within(folderRow()).getByRole('button', { name: 'Open folder' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(invoke).not.toHaveBeenCalled();
  });
});
