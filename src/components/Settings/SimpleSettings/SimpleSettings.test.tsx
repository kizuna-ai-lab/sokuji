/**
 * F2: the highlight-ring effect (lines 91-107) adds `.highlight` to the
 * target section after 100ms and removes it (plus calls
 * `navigateToSettings(null)`) after a further 3000ms, but had NO cleanup —
 * if `highlightSection`/`settingsNavigationTarget` changed within that 3s
 * window, the OLD element kept its ring until its own timer eventually fired,
 * and that stale timer then called `navigateToSettings(null)` on top of
 * whatever the new target had set up. Mirrors the fix already applied to the
 * analogous effect in Settings.tsx:101-121 (see Settings.highlight.test.tsx
 * / SimpleSettings.order.test.tsx for this file's mocking idiom).
 *
 * Mounting the real child sections (ProviderSection, AudioDeviceSection,
 * SystemAudioSection, HelpSection, ...) drags in ServiceFactory, TourProvider
 * and per-provider settings wiring unrelated to this effect, so — per the
 * brief — they're stubbed to plain `<div id="…-section">` markers instead;
 * only AudioDeviceSection and SystemAudioSection matter here since the effect
 * targets 'microphone' and 'participant'.
 *
 * Fix round 1 (R2): the cleanup above only cancelled the pending timers and
 * stripped the ring — it never touched `settingsStore`'s own
 * `settingsNavigationTarget`. Hiding the panel (<Activity mode="hidden">
 * unmounts effects — MainLayout.tsx:245) or unmounting inside the 3s window
 * left the store still pointing at this section, so the NEXT time settings
 * opened it immediately re-scrolled/re-highlighted a step that had already
 * finished. See the two tests below.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

vi.mock('../../../stores/sessionStore', () => ({
  useIsSessionActive: () => false,
  useLockedMode: () => null,
}));

vi.mock('../../../stores/audioStore', () => ({
  useMode: () => 'speaker',
}));

let settingsNavigationTarget: string | null = null;
// Mirrors the real store's navigateToSettings (settingsStore.ts:1310-1311,
// `set({ settingsNavigationTarget: target })`): the fix under test reads the
// target back via `useSettingsStore.getState()`, so the mock must actually
// write through, not just record calls.
const navigateToSettings = vi.fn((target: string | null) => { settingsNavigationTarget = target; });

vi.mock('../../../stores/settingsStore', () => ({
  useNavigateToSettings: () => navigateToSettings,
  useSettingsNavigationTarget: () => settingsNavigationTarget,
  useProvider: () => 'openai',
  useEngineSlotTarget: () => null,
  useSetEngineSlotTarget: () => vi.fn(),
  // getState() rather than the hook: the fix's cleanup reads the store
  // directly (it must see whatever the LATEST navigation set, not the
  // value this component instance was rendered with).
  default: { getState: () => ({ settingsNavigationTarget }) },
}));

// Real child sections pull in ServiceFactory/TourProvider/per-provider
// wiring this effect doesn't touch — stub them to id-bearing markers instead.
// Only 'microphone' and 'participant' matter here since that's what this
// effect targets; ids verified against the real sections:
// AudioDeviceSection.tsx:167 (`id="microphone-section"`) and
// SystemAudioSection.tsx:86 (`id="participant-section"`) — re-check these
// line numbers if either section is restructured.
vi.mock('../sections', () => ({
  ProviderSection: () => null,
  LanguageSection: () => null,
  AudioDeviceSection: ({ showMicrophone }: { showMicrophone?: boolean }) =>
    showMicrophone ? <div id="microphone-section" /> : <div id="speaker-section" />,
  SystemAudioSection: () => <div id="participant-section" />,
  HelpSection: () => null,
}));
vi.mock('../sections/ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('../sections/NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));
vi.mock('../engine/useWasmEngineAdapter', () => ({ useWasmEngineAdapter: () => ({}) }));
vi.mock('../engine/useNativeEngineAdapter', () => ({ useNativeEngineAdapter: () => ({}) }));
vi.mock('../engine/EngineSurface', () => ({ EngineSurface: () => null }));
vi.mock('../engine/StoragePage', () => ({ StoragePage: () => null }));

import SimpleSettings from './SimpleSettings';

// jsdom has no layout engine and doesn't implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const microphoneHighlighted = () => document.getElementById('microphone-section')!.classList.contains('highlight');
const participantHighlighted = () => document.getElementById('participant-section')!.classList.contains('highlight');

beforeEach(() => {
  navigateToSettings.mockClear();
  settingsNavigationTarget = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SimpleSettings — highlight ring cleanup (F2)', () => {
  it('adds .highlight to the target section 100ms after mount', () => {
    render(<SimpleSettings highlightSection="microphone" />);
    expect(microphoneHighlighted()).toBe(false);
    act(() => { vi.advanceTimersByTime(100); });
    expect(microphoneHighlighted()).toBe(true);
  });

  it('switching the target within the 3s window clears the old ring immediately and lights the new one', () => {
    const { rerender } = render(<SimpleSettings highlightSection="microphone" />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(microphoneHighlighted()).toBe(true);

    rerender(<SimpleSettings highlightSection="participant" />);
    // Cleanup from the effect re-run must strip the stale ring right away,
    // not leave it until the old 3000ms timer would have fired on its own.
    expect(microphoneHighlighted()).toBe(false);
    expect(navigateToSettings).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(100); });
    expect(participantHighlighted()).toBe(true);
  });

  it('clears the ring and calls navigateToSettings(null) after a full 3s run', () => {
    const { rerender } = render(<SimpleSettings highlightSection="microphone" />);
    act(() => { vi.advanceTimersByTime(100); });
    rerender(<SimpleSettings highlightSection="participant" />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(participantHighlighted()).toBe(true);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(participantHighlighted()).toBe(false);
    expect(navigateToSettings).toHaveBeenCalledWith(null);
    // The old microphone timer must not have survived to fire its own
    // navigateToSettings(null) on top of this one.
    expect(navigateToSettings).toHaveBeenCalledTimes(1);
  });

  it('unmounting mid-highlight does not throw or leave a dangling timer call', () => {
    const { unmount } = render(<SimpleSettings highlightSection="microphone" />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(microphoneHighlighted()).toBe(true);
    unmount();
    expect(() => { act(() => { vi.advanceTimersByTime(3000); }); }).not.toThrow();
    expect(navigateToSettings).not.toHaveBeenCalled();
  });

  // R2: mirrors production wiring (Settings.tsx:171 / MainLayout.tsx:248),
  // where highlightSection IS settingsNavigationTarget — so the store
  // actually holds this section's name, not null, while the effect runs.
  it('clears the stored navigation target on unmount if it still points at this section', () => {
    settingsNavigationTarget = 'participant';
    const { unmount } = render(<SimpleSettings highlightSection="participant" />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(participantHighlighted()).toBe(true);

    unmount();

    expect(settingsNavigationTarget).toBeNull();
    expect(navigateToSettings).toHaveBeenCalledWith(null);
  });

  // Control for the above: if something else already moved the store on to
  // a DIFFERENT target before this cleanup runs (e.g. a fresh tour step),
  // the cleanup must leave that newer value alone rather than clobbering it
  // with null.
  it('leaves a newer navigation target alone if the store already moved on before unmount', () => {
    settingsNavigationTarget = 'participant';
    const { unmount } = render(<SimpleSettings highlightSection="participant" />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(participantHighlighted()).toBe(true);

    settingsNavigationTarget = 'microphone';
    unmount();

    expect(settingsNavigationTarget).toBe('microphone');
  });
});
