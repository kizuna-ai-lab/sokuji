// The title bar's way into History, on the desktop only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const env = vi.hoisted(() => ({ electron: true }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => env.electron,
}));

import HistoryButton from './HistoryButton';
import { useLayoutStore } from '../../stores/layoutStore';

beforeEach(() => { env.electron = true; useLayoutStore.setState({ historyOpen: false, showSettings: false }); });
afterEach(() => cleanup());

describe('the History button', () => {
  it('shows on the desktop only', () => {
    env.electron = false;
    const { container } = render(<HistoryButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('toggles History from the title bar', () => {
    render(<HistoryButton />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(useLayoutStore.getState().historyOpen).toBe(true);
    expect(screen.getByRole('button', { name: 'History' })).toHaveClass('is-active');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(useLayoutStore.getState().historyOpen).toBe(false);
  });

  it('opening History closes Settings, and opening Settings closes History', () => {
    useLayoutStore.setState({ showSettings: true });
    useLayoutStore.getState().setHistoryOpen(true);
    expect(useLayoutStore.getState()).toMatchObject({ historyOpen: true, showSettings: false });
    useLayoutStore.getState().setShowSettings(true);
    expect(useLayoutStore.getState()).toMatchObject({ historyOpen: false, showSettings: true });
  });
});
