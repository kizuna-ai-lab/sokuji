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
});
