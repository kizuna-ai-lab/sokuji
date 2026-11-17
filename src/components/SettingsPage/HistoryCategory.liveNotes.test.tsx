// The "Live notes during a session" switch and its first-time explanation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true,
}));
vi.mock('../../lib/history/port', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/history/port')>()),
  historyPort: () => ({ status: async () => ({ available: true, dir: '/home/u/History' }), usage: async () => ({ dbBytes: 0, audioBytes: 0, records: 0, binned: 0 }) }),
}));

import i18n from '../../locales';
import zhCN from '../../locales/zh_CN/translation.json';
import { HistoryCategory } from './HistoryCategory';
import useSettingsStore from '../../stores/settingsStore';
import { useLineUpStore } from '../../stores/lineUpStore';

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const row = (name: string) => screen.getByText(name, { selector: '.general-row__name' }).closest('.general-row') as HTMLElement;

beforeEach(() => {
  useSettingsStore.setState({ notesAfterSession: false, notesExplained: false, liveNotes: false, liveNotesExplained: false } as never);
  useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' }, stored: true });
});
afterEach(async () => { cleanup(); await i18n.changeLanguage('en'); });

describe('the live notes switch and its first-time explanation', () => {
  it('on Cancel stays off and remembers nothing, so the explanation comes again on the next try', async () => {
    render(<HistoryCategory locked={false} />);
    await settle();
    const toggle = () => within(row('Live notes during a session')).getByRole('switch');
    fireEvent.click(toggle());
    const explained = screen.getByRole('group', { name: 'Before live notes are written' });
    fireEvent.click(within(explained).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.queryByRole('group', { name: 'Before live notes are written' })).toBeNull();
    expect(useSettingsStore.getState()).toMatchObject({ liveNotes: false, liveNotesExplained: false });
    fireEvent.click(toggle());
    expect(screen.getByRole('group', { name: 'Before live notes are written' })).toBeInTheDocument();
  });

  it('in Chinese is 「会话中写实时纪要」, explained under 「写实时纪要之前」', async () => {
    i18n.addResourceBundle('zh_CN', 'translation', zhCN, true, true);
    await i18n.changeLanguage('zh_CN');
    render(<HistoryCategory locked={false} />);
    await settle();
    fireEvent.click(within(row('会话中写实时纪要')).getByRole('switch'));
    expect(screen.getByRole('group', { name: '写实时纪要之前' })).toBeInTheDocument();
  });
});
