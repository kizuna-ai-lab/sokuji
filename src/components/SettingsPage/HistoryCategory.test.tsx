// "History and notes" (desktop): where History keeps its records and how much space they take, and the switch that
// saves the conversation as a text file when a session ends (it left the export menu, which left the main screen).
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

import { HistoryCategory } from './HistoryCategory';
import useSettingsStore from '../../stores/settingsStore';

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const row = (name: string) => screen.getByText(name, { selector: '.general-row__name' }).closest('.general-row') as HTMLElement;

beforeEach(() => {
  history.status = { available: true, dir: '/home/u/History' };
  useSettingsStore.setState({ autoSaveOnStop: false } as never);
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

  it('saves the conversation as a text file when a session ends, from its switch', async () => {
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(row('Export TXT when a session ends')).getByText('Saves an extra .txt copy of the whole conversation to your Downloads folder. History keeps the record on this computer either way.')).toBeInTheDocument();
    fireEvent.click(within(row('Export TXT when a session ends')).getByRole('switch'));
    await settle();
    expect(useSettingsStore.getState().autoSaveOnStop).toBe(true);
  });

  it('keeps the auto-save switch usable during a session, as the export menu did', async () => {
    render(<HistoryCategory locked />);
    await settle();
    const toggle = within(row('Export TXT when a session ends')).getByRole('switch');
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    await settle();
    expect(useSettingsStore.getState().autoSaveOnStop).toBe(true);
  });

  it('says so when History cannot be opened, and keeps the switch', async () => {
    history.status = { available: false, reason: 'newer', dir: '' };
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(screen.getByText('This History was written by a newer version of Sokuji. Update Sokuji to open it.')).toBeInTheDocument();
    expect(within(row('Export TXT when a session ends')).getByRole('switch')).toBeInTheDocument();
  });
});
