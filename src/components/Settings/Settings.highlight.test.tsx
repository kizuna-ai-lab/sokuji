/**
 * Finding 4: chip clicks (ProviderSection's openSlot, which no longer runs —
 * unreachable at run time under controller ruling 1, kept only as source for
 * Stage 2) deep-linked via `navigateToSettings('provider')`, the SAME
 * mechanism every other settingsNavigationTarget uses to scroll/highlight its
 * section. For every OTHER target that's correct — but for 'provider' the
 * element the lookup finds (`id="provider-section"`) is the WHOLE
 * ProviderSection, not the slot the chip actually opened. That flash now
 * belongs to EngineSurface's own expanded SlotRow (see SlotRow.flash.test.tsx)
 * — Settings.tsx must switch tabs for 'provider' without
 * scrolling/highlighting the section, and must still clear the one-shot
 * target so it can't linger.
 *
 * Follows Settings.test.tsx's mount idiom (AdvancedSettings/SimpleSettings
 * stubbed, i18n stubbed to its default string) but keeps
 * settingsNavigationTarget/navigateToSettings mutable via a shared mock
 * variable, since this suite needs to drive the effect through more than one
 * value — Settings.test.tsx's fixed `() => null` mock can't.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import Settings from './Settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

let mockTarget: string | null = null;
let mockUIMode: 'basic' | 'advanced' = 'advanced';
const navigateToSettings = vi.fn((target: string | null) => { mockTarget = target; });

vi.mock('../../stores/settingsStore', () => ({
  default: { getState: () => ({ settingsNavigationTarget: mockTarget }) },
  useUIMode: () => mockUIMode,
  useSetUIMode: () => vi.fn(),
  useNavigateToSettings: () => navigateToSettings,
  useSettingsNavigationTarget: () => mockTarget,
}));

vi.mock('../../app/useRun', () => ({ useSessionLocked: () => false, useRunParticipantSpeech: () => null }));

vi.mock('../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('./SimpleSettings/SimpleSettings', () => ({ default: () => null }));
vi.mock('./AdvancedSettings/AdvancedSettings', () => ({
  default: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="advanced-body" data-active-tab={activeTab}>
      <div id="provider-section" data-testid="provider-section-el" />
      <div id="microphone-section" data-testid="microphone-section-el" />
      <div id="speech-section" data-testid="speech-section-el" />
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

  it("target='speech' maps to the audio tab and highlights #speech-section", () => {
    mockTarget = 'speech';
    const { getByTestId } = render(<Settings />);

    expect(getByTestId('advanced-body')).toHaveAttribute('data-active-tab', 'audio');
    expect(getByTestId('speech-section-el').classList.contains('highlight')).toBe(false);

    // Past the 150ms scroll delay: highlight lands.
    vi.advanceTimersByTime(200);
    expect(getByTestId('speech-section-el').classList.contains('highlight')).toBe(true);
    expect(navigateToSettings).not.toHaveBeenCalled();

    // Past the 3000ms highlight window: it's removed and the target clears.
    vi.advanceTimersByTime(3000);
    expect(getByTestId('speech-section-el').classList.contains('highlight')).toBe(false);
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

  // The panel closing (its <Activity> hides, running this cleanup) inside the
  // 3000ms highlight window cancelled the timer that would have cleared the
  // target, and nothing else clears it: the next navigateToSettings with the
  // SAME target was a no-op set, so MainLayout's effect never re-fired and the
  // panel stayed shut. The popover's "Full settings →" after a quick close was
  // how it showed. SimpleSettings' effect already clears on this path.
  // The clear is deferred a microtask (see the StrictMode case below), so the
  // cleanup's effect shows after one.
  const flushMicrotasks = () => Promise.resolve();

  it("the panel hiding mid-highlight clears the target, so the same target can reopen it", async () => {
    mockTarget = 'microphone';
    const { getByTestId, unmount } = render(<Settings />);
    vi.advanceTimersByTime(200);
    expect(getByTestId('microphone-section-el').classList.contains('highlight')).toBe(true);

    unmount();
    await flushMicrotasks();
    expect(navigateToSettings).toHaveBeenCalledWith(null);
  });

  // Codex on #616: a close inside the 150ms scroll delay is the same stale
  // target — the highlight never landing is no reason to keep it.
  it("the panel hiding before the highlight landed clears the target too", async () => {
    mockTarget = 'microphone';
    const { unmount } = render(<Settings />);
    vi.advanceTimersByTime(50);
    unmount();
    await flushMicrotasks();
    expect(navigateToSettings).toHaveBeenCalledWith(null);
  });

  it("retargeting mid-highlight does not clobber the newer target", async () => {
    mockTarget = 'microphone';
    const { getByTestId, rerender } = render(<Settings />);
    vi.advanceTimersByTime(200);
    expect(getByTestId('microphone-section-el').classList.contains('highlight')).toBe(true);

    mockTarget = 'turn-detection-tuning';
    rerender(<Settings />);
    await flushMicrotasks();
    expect(getByTestId('microphone-section-el').classList.contains('highlight')).toBe(false);
    expect(navigateToSettings).not.toHaveBeenCalledWith(null);
    vi.advanceTimersByTime(200);
    expect(getByTestId('turn-detection-tuning-el').classList.contains('highlight')).toBe(true);
  });

  // StrictMode's dev-only rehearsal runs the cleanup and the effect again,
  // synchronously, before the 150ms scroll delay. That cleanup must not clear
  // the target, or the re-run effect's own navigation bails and the highlight
  // is silently dropped in development.
  it("StrictMode's effect rehearsal leaves the target alone and the highlight still lands", async () => {
    mockTarget = 'microphone';
    const { getByTestId } = render(<StrictMode><Settings /></StrictMode>);
    await flushMicrotasks();
    expect(navigateToSettings).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(getByTestId('microphone-section-el').classList.contains('highlight')).toBe(true);
  });
});
