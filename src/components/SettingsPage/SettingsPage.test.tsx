import { StrictMode } from 'react';
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
const opened: Array<string | null | undefined> = [];
const AccountsBody = ({ openedBy }: { openedBy?: string | null }) => { opened.push(openedBy); return <div id="provider-section">accounts</div>; };
const bodies = { audio: AudioBody, accounts: AccountsBody };

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
    expect(within(nav).getByRole('button', { name: /Word list/ })).toBeTruthy();
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
    // The owner, 2026-11-17: every download, delete and import there waits for the session to end.
    expect(screen.getByRole('button', { name: /^Models and storage/ })).toHaveTextContent('Locked during a session');
    // …and the line above the page names it among the locked ones, not among "the rest".
    expect(screen.getByRole('status')).toHaveTextContent('the word list, models and keys are locked');
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

// The page hides (not unmounts) when closed; a target left set would make the
// next navigation to the same target a no-op, and the page would not reopen.
describe('the settings page — a navigation target never outlives the page', () => {
  const flushMicrotasks = () => act(async () => { await Promise.resolve(); });
  const target = () => useSettingsStore.getState().settingsNavigationTarget;

  it('closing mid-highlight clears the target, so the same target can open the page again', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    act(() => { useSettingsStore.getState().navigateToSettings('microphone'); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(document.getElementById('microphone-section')).toHaveClass('highlight');
    unmount();
    await flushMicrotasks();
    expect(target()).toBeNull();
  });

  it('closing before the highlight landed clears the target too', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    act(() => { useSettingsStore.getState().navigateToSettings('microphone'); });
    act(() => { vi.advanceTimersByTime(50); });
    unmount();
    await flushMicrotasks();
    expect(target()).toBeNull();
  });

  it('a newer target set meanwhile is kept', async () => {
    vi.useFakeTimers();
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    act(() => { useSettingsStore.getState().navigateToSettings('microphone'); });
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { useSettingsStore.getState().navigateToSettings('speech'); });
    await flushMicrotasks();
    expect(target()).toBe('speech');
    expect(document.getElementById('microphone-section')).not.toHaveClass('highlight');
  });

  it("StrictMode's rehearsal leaves the target alone and the highlight still lands", async () => {
    vi.useFakeTimers();
    useSettingsStore.setState({ settingsNavigationTarget: 'microphone' });
    render(<StrictMode><SettingsPage onClose={vi.fn()} bodies={bodies} /></StrictMode>);
    await flushMicrotasks();
    expect(target()).toBe('microphone');
    act(() => { vi.advanceTimersByTime(200); });
    expect(document.getElementById('microphone-section')).toHaveClass('highlight');
  });
});

describe('the settings page — keys and how a category was opened', () => {
  it('Esc in the search box clears it and keeps the page open; Esc again closes it', () => {
    const onClose = vi.fn();
    render(<SettingsPage onClose={onClose} bodies={bodies} />);
    const search = screen.getByRole('searchbox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'micro' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tells the category the target that opened it, and nothing once the user picks one', () => {
    opened.length = 0;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    act(() => { useSettingsStore.getState().navigateToSettings('provider'); });
    expect(opened[opened.length - 1]).toBe('provider');
    fireEvent.click(screen.getByRole('button', { name: /^Audio/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Accounts and keys/ }));
    expect(opened[opened.length - 1]).toBeNull();
  });
});

// PR review: in the narrow form a keyboard user keeps their place when a view replaces another.
describe('the settings page — focus in the narrow form', () => {
  it('moves focus to the opened category, and back to its entry in the list', () => {
    env.extension = true;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.click(screen.getByRole('button', { name: /^Audio/ }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Audio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Audio/ }));
  });
});

// Owner, 2026-11-15 (visual review): the page's frame as the mock draws it.
describe('the settings page — its frame', () => {
  it('goes back with "Back to the session", has no second close button, and says what a category is for', () => {
    const onClose = vi.fn();
    render(<SettingsPage onClose={onClose} bodies={bodies} />);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Accounts and keys/ }));
    expect(screen.getByText(/each service is filled in once/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the session' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
