import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (k: string, d?: unknown, o?: Record<string, unknown>) => {
      const opts = (typeof d === 'object' && d ? d : o) as Record<string, unknown> | undefined;
      return typeof d === 'string' ? d.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(opts?.[n])) : k;
    },
  }),
}));
const trackEvent = vi.hoisted(() => vi.fn());
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));

import { Banners } from '../Banner/useBanners';
import useAudioSystemStore from '../../stores/audioSystemStore';
import useUpdateStore from '../../stores/updateStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import type { RegionRecord } from '../../lib/region/record';
import { usableHint } from './useRegionHint';

const hint: RegionRecord = { status: 'hint', medians: { us: 177, eu: 237, jp: 13, in: 136 }, recommended: 'jp', at: 1, attempts: 1 };

function seed(opts: { selected?: string | null; region?: string; locked?: boolean; record?: RegionRecord | null } = {}) {
  const { selected = 'kizunaai_soniox', region = 'us', locked = false, record = hint } = opts;
  useProviderStore.setState({
    selected, selectionLocked: locked,
    entries: { kizunaai_soniox: { settings: { region }, credentials: {}, pair: {} }, soniox: { settings: { region: 'us' }, credentials: {}, pair: {} } },
  } as never);
  useRegionRecommendationStore.setState({ records: record ? { kizunaai_soniox: record } : {}, listOpen: null });
}

beforeEach(() => {
  trackEvent.mockReset();
  localStorage.clear();
  useAudioSystemStore.setState({ status: 'ok', dismissed: false });
  useUpdateStore.setState({ status: 'idle', bannerDismissed: false } as never);
  seed();
});
afterEach(cleanup);

describe('the region hint strip', () => {
  it('shows the hint for the selected managed provider, outside a session, and opens the list', () => {
    render(<Banners />);
    expect(screen.getByText('日本 (Japan) is about 160 ms faster than your current region (United States)')).toBeTruthy();
    fireEvent.click(screen.getByText("See each region's speed"));
    expect(useRegionRecommendationStore.getState().listOpen).toBe('kizunaai_soniox');
  });

  it('closing the hint keeps the region and resolves it for good', () => {
    render(<Banners />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(useRegionRecommendationStore.getState().records.kizunaai_soniox?.status).toBe('acted');
    expect(trackEvent).toHaveBeenCalledWith('region_recommendation', {
      provider: 'kizunaai_soniox', medians: hint.medians, current: 'us', recommended: 'jp', outcome: 'kept', chosen: 'us',
    });
    expect(screen.queryByText("See each region's speed")).toBeNull();
  });

  it('uses the unreachable wording when the current region was not measured', () => {
    seed({ record: { ...hint, medians: { us: null, eu: 237, jp: 13, in: 136 } } });
    render(<Banners />);
    expect(screen.getByText('日本 (Japan) answers in 13 ms; your current region (United States) could not be reached')).toBeTruthy();
  });

  it('shows nothing without a pending recommendation or during a session', () => {
    seed({ record: { ...hint, status: 'acted' } });
    const { unmount } = render(<Banners />);
    expect(screen.queryByText("See each region's speed")).toBeNull();
    unmount();
    seed({ locked: true });
    render(<Banners />);
    expect(screen.queryByText("See each region's speed")).toBeNull();
  });

  it('hides the hint once the region is already the recommended one', () => {
    seed({ region: 'jp' });
    render(<Banners />);
    expect(screen.queryByText("See each region's speed")).toBeNull();
  });

  it('hides the hint while another provider is selected and shows it again on return', () => {
    render(<Banners />);
    expect(screen.queryByText("See each region's speed")).toBeTruthy();
    act(() => { useProviderStore.setState({ selected: 'soniox' } as never); });
    expect(screen.queryByText("See each region's speed")).toBeNull();
    act(() => { useProviderStore.setState({ selected: 'kizunaai_soniox' } as never); });
    expect(screen.queryByText("See each region's speed")).toBeTruthy();
  });

  it('hides a hint that appears on screen once the region is changed to the recommended one', () => {
    render(<Banners />);
    expect(screen.queryByText("See each region's speed")).toBeTruthy();
    act(() => { seedRegion('jp'); });
    expect(screen.queryByText("See each region's speed")).toBeNull();
  });

  it('hides the hint while the live region is within 50 ms of the recommended one; the record stays a hint', () => {
    // The region was changed elsewhere (another page, the own-key twin's sync) to a near-best one.
    const near = { ...hint, medians: { us: 177, eu: 50, jp: 13, in: 136 } };
    seed({ record: near, region: 'eu' });
    render(<Banners />);
    expect(screen.queryByText("See each region's speed")).toBeNull();
    expect(useRegionRecommendationStore.getState().records.kizunaai_soniox?.status).toBe('hint');
    expect(usableHint('kizunaai_soniox', 'kizunaai_soniox', false, near, { region: 'eu' })).toBeNull();
    // 50 ms or more is still worth saying; an unmeasured live region still shows it.
    expect(usableHint('kizunaai_soniox', 'kizunaai_soniox', false, { ...near, medians: { ...near.medians, eu: 63 } }, { region: 'eu' })).toMatchObject({ current: 'eu', recommended: 'jp' });
    expect(usableHint('kizunaai_soniox', 'kizunaai_soniox', false, { ...near, medians: { ...near.medians, eu: null } }, { region: 'eu' })).toMatchObject({ current: 'eu', recommended: 'jp' });
  });

  it('shows nothing for a hint record that cannot be worded', () => {
    for (const record of [
      { ...hint, medians: undefined },
      { ...hint, medians: { us: 177, eu: 237, jp: null, in: 136 } },
      { ...hint, recommended: 'mars', medians: { ...hint.medians, mars: 5 } },
    ] as RegionRecord[]) {
      seed({ record });
      const { unmount } = render(<Banners />);
      expect(screen.queryByText("See each region's speed")).toBeNull();
      unmount();
    }
  });
});

function seedRegion(region: string) {
  useProviderStore.setState({
    entries: { kizunaai_soniox: { settings: { region }, credentials: {}, pair: {} } },
  } as never);
}
