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
let mockUIMode: 'basic' | 'advanced' = 'advanced';
const navigateToSettings = vi.fn((target: string | null) => { mockTarget = target; });

vi.mock('../../stores/settingsStore', () => ({
  useUIMode: () => mockUIMode,
  useSetUIMode: () => vi.fn(),
  useNavigateToSettings: () => navigateToSettings,
  useSettingsNavigationTarget: () => mockTarget,
}));

vi.mock('../../app/useRun', () => ({ useSessionLocked: () => false }));

vi.mock('../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('./SimpleSettings/SimpleSettings', () => ({ default: () => null }));
vi.mock('./AdvancedSettings/AdvancedSettings', () => ({
  default: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="advanced-body" data-active-tab={activeTab}>
      <div id="provider-section" data-testid="provider-section-el" />
      <div id="microphone-section" data-testid="microphone-section-el" />
      <div id="turn-detection-tuning-section" data-testid="turn-detection-tuning-el" />
    </div>
  ),
}));

// jsdom has no layout engine and doesn't implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

describe("Settings — the 'provider' navigation target switches tabs without flashing the whole section (Finding 4)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockTarget = null;
    mockUIMode = 'advanced';
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

  // The global turn mode's section sits under the language pair on the
  // General tab (plan 1e-3b-2), no longer among the provider's own settings.
  it("target='turn-detection' switches to the General tab", () => {
    sessionStorage.setItem('panelState.settingsActiveTab', 'provider');
    mockTarget = 'turn-detection';
    const { getByTestId } = render(<Settings />);

    expect(getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'general');
  });

  // The Speech section's summary link (General tab) lands on the provider's
  // VAD block, which the Provider tab draws after the provider's own settings.
  it("target='turn-detection-tuning' switches to the Provider tab and highlights the VAD block", () => {
    mockTarget = 'turn-detection-tuning';
    const { getByTestId } = render(<Settings />);

    expect(getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'provider');
    vi.advanceTimersByTime(200);
    expect(getByTestId('turn-detection-tuning-el').classList.contains('highlight')).toBe(true);
  });

  // From Simple mode the same link switches the UI mode and sets the target
  // in one click: the target is already set while Settings is still Simple
  // (whose own effect never lands on a Provider-tab block), and must be
  // followed the moment the mode reads Advanced.
  it("a 'turn-detection-tuning' target set while still in Simple is followed once the mode is Advanced", () => {
    mockUIMode = 'basic';
    mockTarget = 'turn-detection-tuning';
    const { getByTestId, queryByTestId, rerender } = render(<Settings />);
    expect(queryByTestId('advanced-body')).toBeNull();
    vi.advanceTimersByTime(200);
    expect(navigateToSettings).not.toHaveBeenCalled();

    mockUIMode = 'advanced';
    rerender(<Settings />);
    expect(getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'provider');
    vi.advanceTimersByTime(200);
    expect(getByTestId('turn-detection-tuning-el').classList.contains('highlight')).toBe(true);
  });

  // Review Minor 2: 'model-management' switches tabs (NAVIGATION_TAB_MAP)
  // but has no `#model-management-section` element outside a pushed page, so
  // the 150ms scrollTimer finds nothing. Before the fix, that left the
  // target stuck — the next Fix for the same code was a no-op.
  it("target='model-management' (its section isn't rendered here): still clears after the scroll delay", () => {
    mockTarget = 'model-management';
    const { getByTestId } = render(<Settings />);

    expect(getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'provider');
    expect(navigateToSettings).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(navigateToSettings).toHaveBeenCalledWith(null);
  });
});
