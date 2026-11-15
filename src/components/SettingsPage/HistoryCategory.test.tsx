// "History and notes" (desktop): where History keeps its records and how much space they take.
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
  status: { available: true, dir: '/home/u/History' } as { available: boolean; reason?: 'newer' | 'error'; dir: string },
  usage: { dbBytes: 1_572_864, audioBytes: 0, records: 4, binned: 1 },
}));
vi.mock('../../lib/history/port', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/history/port')>()),
  historyPort: () => ({ status: async () => history.status, usage: async () => history.usage }),
}));

import '../../locales';
import { HistoryCategory } from './HistoryCategory';

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const row = (name: string) => screen.getByText(name, { selector: '.general-row__name' }).closest('.general-row') as HTMLElement;

beforeEach(() => {
  history.status = { available: true, dir: '/home/u/History' };
});
afterEach(() => cleanup());

describe('history and notes', () => {
  it('shows the space History takes and its folder, and opens the folder', async () => {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as { electron: unknown }).electron = { invoke };
    render(<HistoryCategory locked={false} />);
    await settle();
    const folder = row('History folder');
    expect(within(folder).getByText('1.5 MB in 4 records')).toBeInTheDocument();
    expect(within(folder).getByText('/home/u/History')).toBeInTheDocument();
    fireEvent.click(within(folder).getByRole('button', { name: 'Open folder' }));
    expect(invoke).toHaveBeenCalledWith('open-directory', '/home/u/History');
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it('has no auto-save switch: History keeps every session on the desktop', async () => {
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(screen.queryByText('Export TXT when a session ends')).not.toBeInTheDocument();
  });

  it('says so when History cannot be opened', async () => {
    history.status = { available: false, reason: 'newer', dir: '' };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(screen.getByText('This History was written by a newer version of Sokuji. Update Sokuji to open it.')).toBeInTheDocument();
  });
});
