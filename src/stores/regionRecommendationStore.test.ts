import { describe, it, expect, beforeEach } from 'vitest';
import { useRegionRecommendationStore, loadRegionRecords } from './regionRecommendationStore';

describe('regionRecommendationStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useRegionRecommendationStore.setState({ records: {}, listOpen: null });
  });

  it('records survive a relaunch: loadRegionRecords reads what setRecord wrote', () => {
    useRegionRecommendationStore.getState().setRecord('kizunaai_qwen', { status: 'no-change', medians: { sg: 40 }, at: 5, attempts: 1 });
    expect(useRegionRecommendationStore.getState().records.kizunaai_qwen?.status).toBe('no-change');
    expect(loadRegionRecords(localStorage)).toEqual({
      kizunaai_qwen: { status: 'no-change', medians: { sg: 40 }, at: 5, attempts: 1 },
    });
  });

  it('loads nothing without storage and opens/closes the list', () => {
    expect(loadRegionRecords(null)).toEqual({});
    useRegionRecommendationStore.getState().openList('kizunaai_soniox');
    expect(useRegionRecommendationStore.getState().listOpen).toBe('kizunaai_soniox');
    useRegionRecommendationStore.getState().closeList();
    expect(useRegionRecommendationStore.getState().listOpen).toBeNull();
  });

  it('picks up a record another page (side panel / app tab) wrote, through the storage event', () => {
    const records = () => useRegionRecommendationStore.getState().records;
    localStorage.setItem('regionRecommendation.kizunaai_soniox', JSON.stringify({ status: 'chose-manually', at: 9, attempts: 1 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated.key' }));
    expect(records()).toEqual({});
    window.dispatchEvent(new StorageEvent('storage', { key: 'regionRecommendation.kizunaai_soniox' }));
    expect(records()).toEqual({ kizunaai_soniox: { status: 'chose-manually', at: 9, attempts: 1 } });
    // Another page cleared its storage.
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(records()).toEqual({});
  });
});
