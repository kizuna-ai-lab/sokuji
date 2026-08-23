/**
 * Finding 4: chip clicks (ProviderSection's openSlot) deep-link via
 * `navigateToSettings('provider')`, the SAME mechanism every other
 * settingsNavigationTarget uses to scroll/highlight its section. For every
 * OTHER target that's correct — but for 'provider' the element the lookup
 * finds (`id="provider-section"`) is the WHOLE ProviderSection, not the slot
 * the chip actually opened. That flash now belongs to EngineSurface's own
 * expanded SlotRow (see SlotRow.flash.test.tsx) — Settings.tsx must switch
 * tabs for 'provider' without scrolling/highlighting the section, and must
 * still clear the one-shot target so it can't linger.
 *
 * Follows Settings.test.tsx's mount idiom (AdvancedSettings/SimpleSettings
 * stubbed, i18n stubbed to its default string) but keeps
 * settingsNavigationTarget/navigateToSettings mutable via a shared mock
 * variable, since this suite needs to drive the effect through more than one
 * value — Settings.test.tsx's fixed `() => null` mock can't.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import Settings from './Settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

let mockTarget: string | null = null;
const navigateToSettings = vi.fn((target: string | null) => { mockTarget = target; });

vi.mock('../../stores/settingsStore', () => ({
  useUIMode: () => 'advanced',
  useSetUIMode: () => vi.fn(),
  useNavigateToSettings: () => navigateToSettings,
  useSettingsNavigationTarget: () => mockTarget,
}));

vi.mock('../../stores/sessionStore', () => ({
  useIsSessionActive: () => false,
}));

vi.mock('../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('./SimpleSettings/SimpleSettings', () => ({ default: () => null }));
vi.mock('./AdvancedSettings/AdvancedSettings', () => ({
  default: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="advanced-body" data-active-tab={activeTab}>
      <div id="provider-section" data-testid="provider-section-el" />
      <div id="microphone-section" data-testid="microphone-section-el" />
    </div>
  ),
}));

// jsdom has no layout engine and doesn't implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

describe("Settings — the 'provider' navigation target switches tabs without flashing the whole section (Finding 4)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockTarget = null;
    navigateToSettings.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("target='provider': switches to the provider tab, never adds .highlight to provider-section, and clears the target", () => {
    mockTarget = 'provider';
    const { getByTestId } = render(<Settings />);

    expect(getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'provider');
    // No scroll/highlight timer is even scheduled for 'provider' — advancing
    // well past the normal 150ms scroll delay + 3000ms highlight window
    // must not retroactively add the class.
    vi.advanceTimersByTime(5000);
    expect(getByTestId('provider-section-el').classList.contains('highlight')).toBe(false);

    // The existing clear path — same call the highlight-timer branch uses
    // for every other target — fires immediately instead of after a delay.
    expect(navigateToSettings).toHaveBeenCalledWith(null);
  });

  it("target='microphone' (an ordinary section target): still scrolls/highlights normally — the 'provider' special-case doesn't break the rest", () => {
    mockTarget = 'microphone';
    const { getByTestId } = render(<Settings />);

    expect(getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'audio');
    expect(getByTestId('microphone-section-el').classList.contains('highlight')).toBe(false);

    // Past the 150ms scroll delay: highlight lands.
    vi.advanceTimersByTime(200);
    expect(getByTestId('microphone-section-el').classList.contains('highlight')).toBe(true);
    expect(navigateToSettings).not.toHaveBeenCalled();

    // Past the 3000ms highlight window: it's removed and the target clears.
    vi.advanceTimersByTime(3000);
    expect(getByTestId('microphone-section-el').classList.contains('highlight')).toBe(false);
    expect(navigateToSettings).toHaveBeenCalledWith(null);
  });
});
