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

const navigateToSettings = vi.fn();
let settingsNavigationTarget: string | null = null;

vi.mock('../../../stores/settingsStore', () => ({
  useNavigateToSettings: () => navigateToSettings,
  useSettingsNavigationTarget: () => settingsNavigationTarget,
  useProvider: () => 'openai',
  useEngineSlotTarget: () => null,
  useSetEngineSlotTarget: () => vi.fn(),
}));

// Real child sections pull in ServiceFactory/TourProvider/per-provider
// wiring this effect doesn't touch — stub them to id-bearing markers so the
// highlight assertions can find the real section ids the component targets.
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
});
