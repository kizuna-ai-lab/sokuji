import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';

const env = vi.hoisted(() => ({ extension: false, locked: false }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isExtension: () => env.extension,
}));
vi.mock('../../app/useRun', () => ({ useSessionLocked: () => env.locked }));

import { SettingsPage } from './SettingsPage';
import useSettingsStore from '../../stores/settingsStore';

const AudioBody = () => <div id="microphone-section">microphone</div>;
const bodies = { audio: AudioBody };

beforeEach(() => {
  env.extension = false; env.locked = false;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  useSettingsStore.setState({ settingsNavigationTarget: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the settings page', () => {
  it('shows the navigation and the content side by side on a wide desktop window', () => {
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('button', { name: /^(Languages and line-up|Accounts and keys|Models and storage|Audio|Display|General)/ })).toHaveLength(6);
    expect(within(nav).queryByRole('button', { name: /Word list/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Languages and line-up' })).toBeInTheDocument();
  });

  it('shows the list first, then one category, in the extension', () => {
    env.extension = true;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('button', { name: /History/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Audio/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Audio' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByRole('button', { name: /^Audio/ })).toBeInTheDocument();
  });

  it('opens at a navigation target and highlights its element', () => {
    vi.useFakeTimers();
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    act(() => { useSettingsStore.getState().navigateToSettings('microphone'); });
    expect(screen.getByRole('heading', { level: 2, name: 'Audio' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(document.getElementById('microphone-section')).toHaveClass('highlight');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(document.getElementById('microphone-section')).not.toHaveClass('highlight');
    expect(useSettingsStore.getState().settingsNavigationTarget).toBeNull();

    act(() => { useSettingsStore.getState().navigateToSettings('provider'); });
    expect(screen.getByRole('heading', { level: 2, name: 'Accounts and keys' })).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBeNull();
  });

  it('marks what is locked during a session', () => {
    env.locked = true;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    expect(screen.getByRole('status')).toHaveTextContent('A session is running');
    expect(screen.getByRole('button', { name: /^Languages and line-up/ })).toHaveTextContent('Locked during a session');
    expect(screen.getByRole('button', { name: /^Display/ })).toHaveTextContent('Changeable during a session');
  });

  it('Esc goes back to the list in the narrow form and closes in the wide form', () => {
    env.extension = true;
    const onClose = vi.fn();
    render(<SettingsPage onClose={onClose} bodies={bodies} />);
    fireEvent.click(screen.getByRole('button', { name: /^Audio/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
    env.extension = false;
    render(<SettingsPage onClose={onClose} bodies={bodies} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
