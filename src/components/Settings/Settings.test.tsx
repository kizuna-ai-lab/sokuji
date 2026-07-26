import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Settings from './Settings';

// i18n: return the default string passed to t(key, default).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

vi.mock('../../stores/settingsStore', () => ({
  useUIMode: () => 'advanced',
  useSetUIMode: () => vi.fn(),
  useNavigateToSettings: () => vi.fn(),
  useSettingsNavigationTarget: () => null,
}));

vi.mock('../../stores/sessionStore', () => ({
  useIsSessionActive: () => false,
}));

vi.mock('../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

// Stub the mode bodies: the tab bar (PanelBar/TabBar) is what's under test.
vi.mock('./SimpleSettings/SimpleSettings', () => ({ default: () => null }));
vi.mock('./AdvancedSettings/AdvancedSettings', () => ({
  default: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="advanced-body" data-active-tab={activeTab} />
  ),
}));

describe('Settings tab persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('defaults to the general tab', () => {
    render(<Settings />);
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the selected tab across unmount/remount (settings → logs → settings)', () => {
    const { unmount } = render(<Settings />);
    fireEvent.click(screen.getByRole('tab', { name: /provider/i }));
    expect(screen.getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'provider');

    // Switching to the Logs panel unmounts Settings entirely (MainLayout
    // renders panels conditionally); reopening mounts a fresh instance.
    unmount();
    render(<Settings />);

    expect(screen.getByRole('tab', { name: /provider/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'provider');
  });

  it('falls back to general when the stored tab id is unknown', () => {
    sessionStorage.setItem('panelState.settingsActiveTab', 'no-such-tab');
    render(<Settings />);
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'true');
  });
});
