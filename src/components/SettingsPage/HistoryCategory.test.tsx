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
import useSettingsStore from '../../stores/settingsStore';
import { useLineUpStore } from '../../stores/lineUpStore';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const row = (name: string) => screen.getByText(name, { selector: '.general-row__name' }).closest('.general-row') as HTMLElement;

beforeEach(() => {
  history.status = { available: true, dir: '/home/u/History' };
  useSettingsStore.setState({ notesAfterSession: false, notesExplained: false, notesModel: 'gpt-6-luna', liveNotes: false, liveNotesExplained: false } as never);
  useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
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

  // Review: "not uploaded" read as if nothing left the computer; during a session the speech goes to the services.
  it('says the copy History keeps stays here, and that a session still sends speech to the line-up', async () => {
    render(<HistoryCategory locked={false} />);
    expect(await screen.findByText(/on this computer only.*still goes to the services in your line-up/)).toBeInTheDocument();
    expect(screen.queryByText(/not uploaded/)).toBeNull();
  });

  // Review: with notes on, the transcript text leaves the computer too; the line has to say so.
  it('says the transcript text goes to the notes service while notes are on, and only then', async () => {
    const SENT = 'While notes are on, each session’s transcript text is also sent to OpenAI to write them.';
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(screen.queryByText(SENT, { exact: false })).toBeNull();
    act(() => { useSettingsStore.setState({ notesAfterSession: true } as never); });
    expect(screen.getByText(SENT, { exact: false })).toBeInTheDocument();
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

describe('notes after the session', () => {
  const NAME = 'Write notes after each session';
  const toggle = () => within(row(NAME)).getByRole('switch');

  // Owner, 2026-11-17: no "None" in the line-up; with none stored the default service writes the notes, the switch decides.
  it('with no notes service stored, names the default one and can be turned on', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(toggle()).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(row(NAME)).getByText(/^When a session ends, (Kizuna AI|OpenAI) writes its notes from the transcript\.$/)).toBeInTheDocument();
    fireEvent.click(toggle());
    expect(screen.getByRole('group', { name: 'Before notes are written' })).toBeInTheDocument();
  });

  it('explains once, the first time, what is sent where; Cancel leaves it off', async () => {
    render(<HistoryCategory locked={false} />);
    await settle();
    fireEvent.click(toggle());
    const explained = screen.getByRole('group', { name: 'Before notes are written' });
    expect(within(explained).getByText(/sent to OpenAI with your own key/)).toBeInTheDocument();
    expect(within(explained).getByText(/Never the audio, the translation or your account\./)).toBeInTheDocument();
    // The word list goes with every call (owner, 2026-11-17).
    expect(within(explained).getByText(/the spellings in your word list are sent/)).toBeInTheDocument();
    expect(useSettingsStore.getState().notesAfterSession).toBe(false);
    fireEvent.click(within(explained).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.queryByRole('group', { name: 'Before notes are written' })).toBeNull();
    expect(useSettingsStore.getState()).toMatchObject({ notesAfterSession: false, notesExplained: false });

    fireEvent.click(toggle());
    fireEvent.click(within(screen.getByRole('group', { name: 'Before notes are written' })).getByRole('button', { name: 'Turn on' }));
    await settle();
    expect(useSettingsStore.getState()).toMatchObject({ notesAfterSession: true, notesExplained: true });
  });

  it('switches at once after that', async () => {
    useSettingsStore.setState({ notesExplained: true } as never);
    render(<HistoryCategory locked={false} />);
    await settle();
    fireEvent.click(toggle());
    await settle();
    expect(screen.queryByRole('group', { name: 'Before notes are written' })).toBeNull();
    expect(useSettingsStore.getState().notesAfterSession).toBe(true);
    fireEvent.click(toggle());
    await settle();
    expect(useSettingsStore.getState().notesAfterSession).toBe(false);
  });

  it('with Kizuna AI, explains that the text goes through Kizuna AI to OpenAI and who pays, and names the one model', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai' }, stored: true });
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(within(row('Notes model')).queryByRole('combobox')).toBeNull();
    expect(within(row('Notes model')).getByText('Kizuna AI writes the notes with gpt-6-luna.')).toBeInTheDocument();
    fireEvent.click(toggle());
    const explained = screen.getByRole('group', { name: 'Before notes are written' });
    expect(within(explained).getByText(/go through Kizuna AI’s server to OpenAI/)).toBeInTheDocument();
    expect(within(explained).getByText(/the spellings in your word list/)).toBeInTheDocument();
    expect(within(explained).getByText(/paid from the balance that pays for your sessions/)).toBeInTheDocument();
    expect(within(explained).queryByText(/your own key/)).toBeNull();
  });

  const modelSelect = () => within(row('Notes model')).getByRole('combobox', { name: 'Notes model' });
  const choose = (label: string) => {
    const option = within(modelSelect()).getByRole('option', { name: label }) as HTMLOptionElement;
    fireEvent.change(modelSelect(), { target: { value: option.value } });
  };

  it('offers the newest series and Other, and keeps a listed model on choosing it', async () => {
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(modelSelect()).toHaveValue('gpt-6-luna');
    expect(within(modelSelect()).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['gpt-6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra', 'Other']);
    expect(within(row('Notes model')).queryByRole('textbox')).toBeNull();
    choose('gpt-6.1-terra');
    await settle();
    expect(useSettingsStore.getState().notesModel).toBe('gpt-6.1-terra');
  });

  it('takes a name typed by hand under Other, and goes back to the default when it is emptied', async () => {
    render(<HistoryCategory locked={false} />);
    await settle();
    choose('Other');
    const field = within(row('Notes model')).getByRole('textbox', { name: 'Model name' });
    expect(field).toHaveValue('');
    expect(useSettingsStore.getState().notesModel).toBe('gpt-6-luna');
    fireEvent.change(field, { target: { value: ' my-model ' } });
    fireEvent.blur(field);
    await settle();
    expect(useSettingsStore.getState().notesModel).toBe('my-model');
    expect(field).toHaveValue('my-model');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    await settle();
    expect(useSettingsStore.getState().notesModel).toBe('gpt-6-luna');
    expect(modelSelect()).toHaveValue('gpt-6-luna');
    expect(within(row('Notes model')).queryByRole('textbox')).toBeNull();
  });

  it('shows a stored model that is not listed under Other, with its name', async () => {
    useSettingsStore.setState({ notesModel: 'o3' } as never);
    render(<HistoryCategory locked={false} />);
    await settle();
    expect((within(modelSelect()).getByRole('option', { name: 'Other' }) as HTMLOptionElement).selected).toBe(true);
    expect(within(row('Notes model')).getByRole('textbox', { name: 'Model name' })).toHaveValue('o3');
  });
});

describe('the first-time explanation sits under the switch that asked for it (B-09)', () => {
  const AFTER = 'Write notes after each session';
  const LIVE = 'Live notes during a session';

  it('under "Write notes after each session" for that switch, above the live notes row', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai' }, stored: true });
    render(<HistoryCategory locked={false} />);
    await settle();
    fireEvent.click(within(row(AFTER)).getByRole('switch'));
    const explained = screen.getByRole('group', { name: 'Before notes are written' });
    expect(explained.previousElementSibling).toBe(row(AFTER));
    expect(explained.nextElementSibling).toBe(row(LIVE));
  });

  // Turning on one switch, then the other, shows only the second's explanation, under its own switch;
  // neither switch is on until its explanation is accepted; Cancel puts each away.
  it('shows only the explanation of the switch last turned on, under it, and Cancel puts it away', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai' }, stored: true });
    render(<HistoryCategory locked={false} />);
    await settle();
    fireEvent.click(within(row(AFTER)).getByRole('switch'));
    expect(screen.getByRole('group', { name: 'Before notes are written' }).previousElementSibling).toBe(row(AFTER));
    fireEvent.click(within(row(LIVE)).getByRole('switch'));
    expect(screen.queryByRole('group', { name: 'Before notes are written' })).toBeNull();
    const live = screen.getByRole('group', { name: 'Before live notes are written' });
    expect(live.previousElementSibling).toBe(row(LIVE));
    expect(useSettingsStore.getState()).toMatchObject({ notesAfterSession: false, liveNotes: false });
    fireEvent.click(within(live).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.queryByRole('group', { name: /^Before / })).toBeNull();
    expect(useSettingsStore.getState()).toMatchObject({ notesAfterSession: false, liveNotes: false, liveNotesExplained: false });
  });

  it('under "Live notes during a session" for that switch', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai' }, stored: true });
    render(<HistoryCategory locked={false} />);
    await settle();
    fireEvent.click(within(row(LIVE)).getByRole('switch'));
    const explained = screen.getByRole('group', { name: 'Before live notes are written' });
    expect(explained.previousElementSibling).toBe(row(LIVE));
  });
});

describe('live notes during a session', () => {
  const NAME = 'Live notes during a session';
  const toggle = () => within(row(NAME)).getByRole('switch');

  it('with no notes service stored, names the default one and can be turned on', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    render(<HistoryCategory locked={false} />);
    await settle();
    expect(toggle()).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(row(NAME)).getByText(/^During a session, (Kizuna AI|OpenAI) keeps short notes/)).toBeInTheDocument();
  });

  it('with Kizuna AI, explains what goes through Kizuna AI to OpenAI every 20 seconds, and who pays', async () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai' }, stored: true });
    render(<HistoryCategory locked={false} />);
    await settle();
    fireEvent.click(toggle());
    const explained = screen.getByRole('group', { name: 'Before live notes are written' });
    expect(within(explained).getByText(/every 20 seconds/)).toBeInTheDocument();
    expect(within(explained).getByText(/go through Kizuna AI’s server to OpenAI/)).toBeInTheDocument();
    expect(within(explained).getByText(/paid from the balance that pays for your sessions/)).toBeInTheDocument();
  });

  it('explains once what is sent every 20 seconds, then switches at once; it can be turned off during a session', async () => {
    render(<HistoryCategory locked />);
    await settle();
    fireEvent.click(toggle());
    const explained = screen.getByRole('group', { name: 'Before live notes are written' });
    expect(within(explained).getByText(/every 20 seconds/)).toBeInTheDocument();
    expect(within(explained).getByText(/the notes so far and the spellings in your word list are sent to OpenAI with your own key/)).toBeInTheDocument();
    fireEvent.click(within(explained).getByRole('button', { name: 'Turn on' }));
    await settle();
    expect(useSettingsStore.getState()).toMatchObject({ liveNotes: true, liveNotesExplained: true });
    fireEvent.click(toggle());
    await settle();
    expect(screen.queryByRole('group', { name: 'Before live notes are written' })).toBeNull();
    expect(useSettingsStore.getState().liveNotes).toBe(false);
  });
});
