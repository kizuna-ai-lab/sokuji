import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

const run = vi.hoisted(() => vi.fn());
vi.mock('../../lib/region/runRecommendation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/region/runRecommendation')>()),
  runRegionRecommendation: run,
}));
const tour = vi.hoisted(() => ({ active: false }));
vi.mock('../Tour/TourProvider', () => ({ useTour: () => ({ active: tour.active }) }));
const auth = vi.hoisted(() => ({ signedIn: true, loaded: true }));
vi.mock('../providers/useAuthContext', () => ({
  useAuthContext: () => ({ signedIn: auth.signedIn, loaded: auth.loaded, userId: 'u', getToken: vi.fn() }),
}));
const reportWarning = vi.hoisted(() => vi.fn());
vi.mock('../../lib/diagnostics/report', () => ({ reportWarning }));
const trackEvent = vi.hoisted(() => vi.fn());
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
const layout = vi.hoisted(() => ({ wizardOpen: false }));
vi.mock('../../stores/layoutStore', () => ({ useSetupWizardOpen: () => layout.wizardOpen }));

import RegionRecommendation from './RegionRecommendation';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';

const entry = { settings: {}, credentials: {}, pair: {} } as never;

function seed(selected: string | null, entries: string[] = selected ? [selected] : []) {
  useProviderStore.setState({
    selected,
    selectionLocked: false,
    entries: Object.fromEntries(entries.map((id) => [id, entry])),
  } as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  reportWarning.mockReset();
  run.mockReset().mockResolvedValue(undefined);
  tour.active = false; auth.signedIn = true; auth.loaded = true; layout.wizardOpen = false;
  useRegionRecommendationStore.setState({ records: {} });
  seed('kizunaai_soniox');
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('RegionRecommendation', () => {
  it('runs the selected managed provider’s measurement 5 s after the gate opens, once', () => {
    render(<RegionRecommendation />);
    expect(screen.getByTestId('region-recommendation')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4999); });
    expect(run).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(run).toHaveBeenCalledWith('kizunaai_soniox', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('hands the run a tracker that sends the region_recommendation event', () => {
    render(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(5000); });
    const e = { provider: 'kizunaai_soniox', medians: {}, current: 'us', recommended: null, outcome: 'no_change', chosen: 'us' };
    run.mock.calls[0][1].track(e);
    expect(trackEvent).toHaveBeenCalledWith('region_recommendation', e);
  });

  it('waits for the tour and for an idle run; a session starting aborts the pending run', () => {
    tour.active = true;
    const { rerender } = render(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(run).not.toHaveBeenCalled();
    tour.active = false;
    act(() => { useProviderStore.setState({ selectionLocked: true }); });
    rerender(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(run).not.toHaveBeenCalled();
    act(() => { useProviderStore.setState({ selectionLocked: false }); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(run).toHaveBeenCalledTimes(1);
    const { signal } = run.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    act(() => { useProviderStore.setState({ selectionLocked: true }); });
    expect(signal.aborted).toBe(true);
  });

  it('a session starting before the delay elapses cancels the timer', () => {
    render(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { useProviderStore.setState({ selectionLocked: true }); });
    act(() => { vi.advanceTimersByTime(10000); });
    expect(run).not.toHaveBeenCalled();
  });

  it('never measures for own-key Soniox, signed out, or with a final record', () => {
    seed('soniox');
    const { unmount } = render(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(run).not.toHaveBeenCalled();
    unmount();

    seed('kizunaai_soniox'); auth.signedIn = false;
    const second = render(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(run).not.toHaveBeenCalled();
    second.unmount();

    auth.signedIn = true;
    useRegionRecommendationStore.setState({ records: { kizunaai_soniox: { status: 'no-change', at: 1, attempts: 1 } } });
    render(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(run).not.toHaveBeenCalled();
  });

  const blockers: Array<[string, () => () => void, () => void]> = [
    ['the provider entry to load', () => { seed('kizunaai_soniox', []); return () => {}; },
      () => useProviderStore.setState({ entries: { kizunaai_soniox: entry } } as never)],
    ['the sign-in to load', () => { auth.loaded = false; return () => {}; }, () => { auth.loaded = true; }],
    ['the wizard to close', () => { layout.wizardOpen = true; return () => {}; }, () => { layout.wizardOpen = false; }],
    ['the network', () => {
      const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      return () => spy.mockRestore();
    }, () => { window.dispatchEvent(new Event('online')); }],
  ];
  it.each(blockers)('waits for %s, then runs 5 s after it clears', (_n, block, open) => {
    const restore = block();
    const { rerender } = render(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(run).not.toHaveBeenCalled();
    restore();
    act(() => { open(); });
    rerender(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(4999); });
    expect(run).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('changing the selected provider clears the pending timer and aborts a run in flight', () => {
    seed('kizunaai_soniox', ['kizunaai_soniox', 'kizunaai_qwen']);
    render(<RegionRecommendation />);
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { useProviderStore.setState({ selected: 'kizunaai_qwen' }); });
    act(() => { vi.advanceTimersByTime(4999); });
    expect(run).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(run).toHaveBeenCalledWith('kizunaai_qwen', expect.anything());
    const { signal } = run.mock.calls[0][1];
    act(() => { useProviderStore.setState({ selected: 'kizunaai_soniox' }); });
    expect(signal.aborted).toBe(true);
  });

  it('records a failed run once and leaves no unhandled rejection', async () => {
    run.mockRejectedValue(new Error('boom'));
    render(<RegionRecommendation />);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(reportWarning).toHaveBeenCalledTimes(1);
    expect(reportWarning).toHaveBeenCalledWith('RegionRecommendation', expect.any(String), expect.objectContaining({ dedupeKey: 'region:run', cause: expect.any(Error) }));
  });
});
