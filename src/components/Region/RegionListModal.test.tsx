import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';

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
const requestRegionChange = vi.hoisted(() => vi.fn());
vi.mock('../../lib/region/regionChange', () => ({ requestRegionChange }));
vi.mock('../providers/useAuthContext', () => ({
  useAuthContext: () => ({ signedIn: true, loaded: true, userId: 'u', getToken: vi.fn() }),
}));

import RegionListModal from './RegionListModal';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import type { RegionRecord } from '../../lib/region/record';

const hint: RegionRecord = { status: 'hint', medians: { us: 177, eu: 237, jp: 13, in: 136 }, recommended: 'jp', at: 1, attempts: 1 };

function open(record: RegionRecord = hint) {
  useProviderStore.setState({
    selected: 'kizunaai_soniox', selectionLocked: false,
    entries: { kizunaai_soniox: { settings: { region: 'us' }, credentials: {}, pair: {} } },
  } as never);
  useRegionRecommendationStore.setState({ records: { kizunaai_soniox: record }, listOpen: 'kizunaai_soniox' });
}
const row = (label: string) => screen.getByText(label).closest('li') as HTMLElement;
const state = () => useRegionRecommendationStore.getState();

beforeEach(() => { trackEvent.mockReset(); requestRegionChange.mockReset(); localStorage.clear(); open(); });
afterEach(cleanup);

describe('RegionListModal', () => {
  it('renders nothing while closed', () => {
    useRegionRecommendationStore.setState({ listOpen: null });
    render(<RegionListModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists rows fastest first, unreachable last', () => {
    open({ ...hint, medians: { us: 177, eu: null, jp: 13, in: 136 } });
    render(<RegionListModal />);
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.region-list__name')?.textContent))
      .toEqual(['日本 (Japan)', 'India', 'United States', 'European Union']);
  });

  it('lists every region with its median, marks recommended and current, one Switch per measured non-current row', () => {
    render(<RegionListModal />);
    expect(screen.getByRole('dialog', { name: 'Choose a faster region' })).toBeTruthy();
    expect(row('United States')).toHaveTextContent('177 ms');
    expect(row('United States')).toHaveTextContent('Current');
    expect(within(row('United States')).queryByRole('button')).toBeNull();
    expect(row('日本 (Japan)')).toHaveTextContent('13 ms');
    expect(row('日本 (Japan)')).toHaveTextContent('Recommended');
    expect(row('India')).toHaveTextContent('136 ms');
    expect(screen.getAllByRole('button', { name: 'Switch' })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Keep United States' })).toBeTruthy();
  });

  it("an unmeasured region reads Couldn't reach and has no button", () => {
    open({ ...hint, medians: { ...hint.medians, in: null } });
    render(<RegionListModal />);
    expect(row('India')).toHaveTextContent("Couldn't reach");
    expect(within(row('India')).queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Switch' })).toHaveLength(2);
  });

  it('Switch goes through the region path; a confirmed switch resolves the hint as switched', async () => {
    requestRegionChange.mockResolvedValue(true);
    render(<RegionListModal />);
    await act(async () => { fireEvent.click(within(row('日本 (Japan)')).getByRole('button', { name: 'Switch' })); });
    expect(requestRegionChange).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'kizunaai_soniox', to: 'jp', origin: 'list', auth: expect.anything() }));
    expect(state().records.kizunaai_soniox?.status).toBe('acted');
    expect(trackEvent).toHaveBeenCalledWith('region_recommendation', {
      provider: 'kizunaai_soniox', medians: hint.medians, current: 'us', recommended: 'jp', outcome: 'switched', chosen: 'jp',
    });
    expect(state().listOpen).toBeNull();
  });

  it('a cancelled switch leaves the list open and the record pending', async () => {
    requestRegionChange.mockResolvedValue(false);
    render(<RegionListModal />);
    await act(async () => { fireEvent.click(within(row('India')).getByRole('button', { name: 'Switch' })); });
    expect(state().listOpen).toBe('kizunaai_soniox');
    expect(state().records.kizunaai_soniox?.status).toBe('hint');
    expect(trackEvent).not.toHaveBeenCalled();
    expect(within(row('India')).getByRole('button', { name: 'Switch' })).not.toBeDisabled();
  });

  it('guards a double click while a switch is pending', async () => {
    let settle: (v: boolean) => void = () => {};
    requestRegionChange.mockReturnValue(new Promise<boolean>((r) => { settle = r; }));
    render(<RegionListModal />);
    const btn = within(row('India')).getByRole('button', { name: 'Switch' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(requestRegionChange).toHaveBeenCalledTimes(1);
    await act(async () => { settle(false); });
  });

  it('Keep and × keep the region and write the record', () => {
    render(<RegionListModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep United States' }));
    expect(requestRegionChange).not.toHaveBeenCalled();
    expect(state().records.kizunaai_soniox?.status).toBe('acted');
    expect(state().listOpen).toBeNull();
    expect(trackEvent).toHaveBeenCalledWith('region_recommendation', expect.objectContaining({ outcome: 'kept', chosen: 'us' }));
    open();
    trackEvent.mockReset();
    const { container } = render(<RegionListModal />);
    fireEvent.click(container.ownerDocument.querySelector('.close-button') as HTMLElement);
    expect(state().records.kizunaai_soniox?.status).toBe('acted');
    expect(trackEvent).toHaveBeenCalledWith('region_recommendation', expect.objectContaining({ outcome: 'kept', chosen: 'us' }));
  });

  it('Keep, x and Switch do nothing while a switch is pending', async () => {
    let settle: (v: boolean) => void = () => {};
    requestRegionChange.mockReturnValue(new Promise<boolean>((r) => { settle = r; }));
    const { container } = render(<RegionListModal />);
    const btn = within(row('India')).getByRole('button', { name: 'Switch' });
    fireEvent.click(btn);
    fireEvent.click(within(row('日本 (Japan)')).getByRole('button', { name: 'Switch' }));
    expect(requestRegionChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Keep United States' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep United States' }));
    fireEvent.click(container.ownerDocument.querySelector('.close-button') as HTMLElement);
    expect(state().listOpen).toBe('kizunaai_soniox');
    expect(trackEvent).not.toHaveBeenCalled();
    await act(async () => { settle(true); });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('region_recommendation', expect.objectContaining({ outcome: 'switched', chosen: 'in' }));
  });

  it('closes without writing when a session starts, and the hint can come back', () => {
    render(<RegionListModal />);
    act(() => { useProviderStore.setState({ selectionLocked: true } as never); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state().listOpen).toBeNull();
    expect(state().records.kizunaai_soniox?.status).toBe('hint');
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('closes without writing when its provider is deselected', () => {
    render(<RegionListModal />);
    act(() => { useProviderStore.setState({ selected: 'soniox' } as never); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state().listOpen).toBeNull();
    expect(state().records.kizunaai_soniox?.status).toBe('hint');
  });

  it('does not open for a record that cannot be listed', () => {
    open({ ...hint, medians: undefined });
    render(<RegionListModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state().listOpen).toBeNull();
  });
});
