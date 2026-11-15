// "General" as mock v19 draws it (the owner approved it, 2026-11-15): two groups of plain rows — the name and a line
// about it on the left, a real control on the right — and the support address and the discussion board last.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
const env = vi.hoisted(() => ({ electron: true, extension: false }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => env.electron,
  isExtension: () => env.extension,
}));
const tour = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../Tour/useStartBasicsTour', () => ({ useStartBasicsTour: () => tour.start }));
const help = vi.hoisted(() => ({ change: vi.fn(), check: vi.fn(), open: vi.fn(), status: 'idle', result: null as null | string }));
vi.mock('../Settings/sections/helpActions', () => ({
  useInterfaceLanguageChange: () => help.change,
  useUpdateCheck: () => ({ status: help.status, result: help.result, check: help.check }),
  openExternalUrl: help.open,
}));

vi.stubGlobal('__APP_VERSION__', '0.50.2');

import { GeneralCategory } from './GeneralCategory';
import { useLayoutStore } from '../../stores/layoutStore';
import useSettingsStore from '../../stores/settingsStore';

beforeEach(() => {
  env.electron = true;
  env.extension = false;
  help.status = 'idle';
  help.result = null;
  for (const f of [tour.start, help.change, help.check, help.open]) f.mockClear();
  useLayoutStore.setState({ setupWizardOpen: false });
  useSettingsStore.setState({ theme: 'system', diagnosticLogs: false } as never);
});
afterEach(() => cleanup());

const row = (name: string) => screen.getByText(name, { selector: '.general-row__name' }).closest('.general-row') as HTMLElement;

describe('general', () => {
  it('has two groups: the basics, then maintenance and help', () => {
    render(<GeneralCategory locked={false} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Basics', 'Maintenance and help']);
  });

  it('picks the interface language from a select on its row', () => {
    render(<GeneralCategory locked={false} />);
    fireEvent.change(within(row('Interface Language')).getByRole('combobox'), { target: { value: 'ja' } });
    expect(help.change).toHaveBeenCalledWith('ja');
  });

  it('picks the appearance from three side-by-side choices', () => {
    render(<GeneralCategory locked={false} />);
    const choices = within(row('Appearance')).getAllByRole('button');
    expect(choices.map((b) => b.textContent)).toEqual(['System', 'Dark', 'Light']);
    expect(choices[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(choices[1]);
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('turns the diagnostic logs on with a switch, saying what they are under the name', () => {
    render(<GeneralCategory locked={false} />);
    expect(within(row('Diagnostic logs')).getByText(/attach it to a bug report/)).toBeInTheDocument();
    fireEvent.click(within(row('Diagnostic logs')).getByRole('switch'));
    expect(useSettingsStore.getState().diagnosticLogs).toBe(true);
  });

  it('on the desktop, checks for updates and says how the check went', () => {
    const first = render(<GeneralCategory locked={false} />);
    expect(within(row('Updates')).getByText(/^You have v/)).toBeInTheDocument();
    fireEvent.click(within(row('Updates')).getByRole('button'));
    expect(help.check).toHaveBeenCalled();
    first.unmount();
    help.result = 'not-available';
    render(<GeneralCategory locked={false} />);
    expect(within(row('Updates')).getByRole('button')).toHaveTextContent('Up to date');
  });

  it('in the extension, shows the version only: the store keeps it up to date', () => {
    env.electron = false;
    env.extension = true;
    render(<GeneralCategory locked={false} />);
    expect(screen.queryByText('Updates', { selector: '.general-row__name' })).toBeNull();
    expect(within(row('Version')).getByText(/store keeps the extension up to date/)).toBeInTheDocument();
  });

  it('runs the setup wizard again, but not during a session', () => {
    const first = render(<GeneralCategory locked={false} />);
    fireEvent.click(within(row('Setup wizard')).getByRole('button'));
    expect(useLayoutStore.getState().setupWizardOpen).toBe(true);
    first.unmount();
    render(<GeneralCategory locked />);
    expect(within(row('Setup wizard')).getByRole('button')).toBeDisabled();
  });

  it('starts the guide again', () => {
    render(<GeneralCategory locked={false} />);
    fireEvent.click(within(row('Guide')).getByRole('button'));
    expect(tour.start).toHaveBeenCalled();
  });

  it('ends with the support address and the discussion board, as two quiet links', () => {
    render(<GeneralCategory locked={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'support@kizuna.ai' }));
    expect(help.open).toHaveBeenCalledWith('mailto:support@kizuna.ai');
    fireEvent.click(screen.getByRole('button', { name: 'Discussions' }));
    expect(help.open).toHaveBeenCalledWith('https://github.com/kizuna-ai-lab/sokuji/discussions');
  });
});
