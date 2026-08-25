import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const completeTour = vi.fn(async () => {});
vi.mock('../../stores/setupStore', () => ({ useSetupStore: { getState: () => ({ completeTour }) } }));
const navigateToSettings = vi.fn();
vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ navigateToSettings }) } }));
const setShowSettings = vi.fn();
vi.mock('../../stores/layoutStore', () => ({ useLayoutStore: { getState: () => ({ setShowSettings }) } }));
const trackEvent = vi.fn();
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));

import { TourProvider, useTour } from './TourProvider';
import type { TourCtx } from './tourContext';

const ctx: TourCtx = { scenario: 'understand-others', providerPath: 'managed', provider: 'kizunaai_soniox' as any, platform: 'electron', os: 'linux', mode: 'participant', textOnly: true, isSignedIn: true, apiKeyValid: true };
// visible for ctx: welcome, mode-picker, participant-source, subtitle, account, start, done

const Probe: React.FC = () => {
  const t = useTour();
  return (
    <div>
      <span data-testid="state">{t.active ? `${t.index}:${t.step?.id}:${t.resolving ? 'wait' : t.target ? 'on' : 'center'}` : 'idle'}</span>
      <button onClick={() => t.start(ctx)}>start</button>
      <button onClick={t.next}>next</button>
      <button onClick={t.back}>back</button>
      <button onClick={t.skip}>skip</button>
    </div>
  );
};

// `anchors()` sets up the elements `waitForAnchor` resolves against. It writes
// into a dedicated sibling container rather than `document.body.innerHTML =`
// directly: several tests call `anchors()` again *after* `mount()` has already
// rendered the Probe, and replacing the whole body's HTML would destroy RTL's
// render container (and the Probe's buttons) along with the old anchors.
// `document.querySelector` still finds anchors regardless of container
// nesting, so this preserves every test's original intent unchanged.
let anchorHost: HTMLElement;
const anchors = (ids: string[]) => {
  anchorHost.innerHTML = ids.map((id) => `<div data-tour="${id}"></div>`).join('');
};
// Drains enough microtask turns for the polling wait (fastWait below polls on
// microtasks and times out after ~10 of them) plus the resolution that follows.
const flush = () => act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute('data-hidden') ? [] : [{} as DOMRect]) as unknown as DOMRectList;
  });
  // Some tests append extra nodes straight onto document.body (e.g. a
  // manually-inserted hidden anchor); start every test from an empty body so
  // one test's leftovers can never shadow another's `[data-tour]` query.
  document.body.innerHTML = '';
  anchorHost = document.createElement('div');
  document.body.appendChild(anchorHost);
  completeTour.mockClear(); navigateToSettings.mockClear(); setShowSettings.mockClear(); trackEvent.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Polls synchronously up to `n` times so a test never waits on real frames.
const fastWait = { timeoutMs: 10, schedule: (cb: () => void) => queueMicrotask(cb), now: (() => { let t = 0; return () => (t += 1); })() };

const mount = () => { anchors([]); render(<TourProvider waitOptions={fastWait}><Probe /></TourProvider>); };

describe('TourProvider', () => {
  it('is idle until started, then shows the centred welcome', async () => {
    mount();
    expect(state()).toBe('idle');
    fireEvent.click(screen.getByText('start'));
    await flush();
    expect(state()).toBe('0:welcome:center');
    expect(trackEvent).toHaveBeenCalledWith('onboarding_started', expect.objectContaining({ chapter: 'basics' }));
    expect(trackEvent).toHaveBeenCalledWith('onboarding_step_viewed', expect.objectContaining({ step_id: 'welcome', step_index: 0 }));
  });

  it('runs prepare, waits for the anchor, and highlights it', async () => {
    mount();
    anchors(['mode-picker', 'participant-section']);
    fireEvent.click(screen.getByText('start')); await flush();
    fireEvent.click(screen.getByText('next')); await flush();
    expect(state()).toBe('1:mode-picker:on');
    fireEvent.click(screen.getByText('next')); await flush();
    expect(setShowSettings).toHaveBeenCalledWith(true);
    expect(navigateToSettings).toHaveBeenCalledWith('participant');
    expect(state()).toBe('2:participant-source:on');
  });

  it('skips a step whose anchor never becomes visible, and says so', async () => {
    mount();
    anchors(['mode-picker', 'subtitle-enter']);           // participant-section absent
    document.body.insertAdjacentHTML('beforeend', '<div data-tour="participant-section" data-hidden></div>');
    fireEvent.click(screen.getByText('start')); await flush();
    fireEvent.click(screen.getByText('next')); await flush();      // mode-picker
    fireEvent.click(screen.getByText('next')); await flush(); await flush();
    expect(state()).toBe('3:subtitle:on');
    expect(trackEvent).toHaveBeenCalledWith('onboarding_step_skipped', { chapter: 'basics', step_id: 'participant-source', reason: 'target-missing' });
  });

  it('back goes to the previous visible step', async () => {
    mount();
    anchors(['mode-picker']);
    fireEvent.click(screen.getByText('start')); await flush();
    fireEvent.click(screen.getByText('next')); await flush();
    fireEvent.click(screen.getByText('back')); await flush();
    expect(state()).toBe('0:welcome:center');
  });

  it('finishing the last step persists "finished"; skip persists "skipped"', async () => {
    mount();
    anchors(['mode-picker', 'participant-section', 'subtitle-enter', 'account-button', 'main-action']);
    fireEvent.click(screen.getByText('start')); await flush();
    for (let i = 0; i < 6; i++) { fireEvent.click(screen.getByText('next')); await flush(); }
    expect(state()).toBe('6:done:center');
    fireEvent.click(screen.getByText('next')); await flush();
    expect(state()).toBe('idle');
    expect(completeTour).toHaveBeenCalledWith('basics', 'finished');
    expect(trackEvent).toHaveBeenCalledWith('onboarding_completed', expect.objectContaining({ completion_method: 'finished', total_steps: 7 }));

    fireEvent.click(screen.getByText('start')); await flush();
    fireEvent.click(screen.getByText('skip')); await flush();
    expect(state()).toBe('idle');
    expect(completeTour).toHaveBeenCalledWith('basics', 'skipped');
  });
});
