// During a session the word list and the session background are locked, with languages and the line-up.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

const env = vi.hoisted(() => ({ locked: false }));
vi.mock('../../app/useRun', () => ({ useSessionLocked: () => env.locked }));
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: vi.fn(async () => ({ success: true })) }) },
}));

import '../../locales';
import { SettingsPage } from './SettingsPage';
import { WordsCategory } from './WordsCategory';
import { useWordList } from '../../lib/words/list';
import useSettingsStore from '../../stores/settingsStore';

const bodies = { words: WordsCategory };
const navItem = (name: RegExp) => within(screen.getByRole('navigation')).getByRole('button', { name });

beforeEach(() => {
  env.locked = false;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  useSettingsStore.setState({ settingsNavigationTarget: null });
  useWordList.setState({ entries: [{ written: 'Soniox', translation: 'ソニオックス', heardAs: 'sonic ox' }], background: 'Weekly sync.', loaded: true });
});
afterEach(() => cleanup());

describe('word list locked during a session', () => {
  it('marks the word list locked like the languages and line-up, while audio is partly and display fully changeable', () => {
    env.locked = true;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    expect(navItem(/^Word list/)).toHaveTextContent('Locked during a session');
    expect(navItem(/^Languages and line-up/)).toHaveTextContent('Locked during a session');
    expect(navItem(/^Audio/)).toHaveTextContent('Partly locked during a session');
    expect(navItem(/^Display/)).toHaveTextContent('Changeable during a session');
  });

  it('passes the session lock to the word list page, where every cell, button and the background are disabled', () => {
    env.locked = true;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.click(navItem(/^Word list/));
    for (const label of ['Written as 1', 'Translation 1', 'Often heard as 1', 'Session background', 'Remove 1']) {
      expect(screen.getByLabelText(label), label).toBeDisabled();
    }
    expect(screen.getByLabelText(/Paste several/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add a row' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add these' })).toBeDisabled();
  });

  it('leaves the word list editable when no session is running', () => {
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.click(navItem(/^Word list/));
    for (const label of ['Written as 1', 'Translation 1', 'Often heard as 1', 'Session background', 'Remove 1']) {
      expect(screen.getByLabelText(label), label).toBeEnabled();
    }
    expect(screen.getByRole('button', { name: 'Add a row' })).toBeEnabled();
  });
});
