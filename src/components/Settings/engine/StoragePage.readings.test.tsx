import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LOCAL_INFERENCE_DEFAULTS } from '../../../providers/localInference/settings';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (_k: string, d?: any, opts?: any) =>
      typeof d === 'string' ? d.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? '')) : _k,
    }),
  };
});
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: vi.fn(() => ({ setSetting: vi.fn().mockResolvedValue(undefined), getSetting: vi.fn() })) },
}));
const dict = vi.hoisted(() => ({ stored: true, deleted: 0 }));
vi.mock('../../../lib/reading/ja/dictionary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/reading/ja/dictionary')>()),
  isDictionaryStored: async () => dict.stored,
  deleteDictionary: async () => { dict.deleted += 1; dict.stored = false; },
}));

const { StoragePage } = await import('./StoragePage');
const WASM = { settings: { ...LOCAL_INFERENCE_DEFAULTS, selections: {} }, pair: { source: 'ja', target: 'en' } };

beforeEach(() => { dict.stored = true; dict.deleted = 0; });

describe('the readings dictionary on the storage page', () => {
  it('lists the readings dictionary with the other downloaded models', async () => {
    render(<StoragePage provider="wasm" {...WASM} />);
    const row = await screen.findByTestId('storage-row-readings-ja');
    expect(row).toHaveTextContent('Readings dictionary (Japanese)');
    expect(row).toHaveTextContent('10.0 MB');
    fireEvent.click(screen.getByTestId('storage-delete-readings-ja'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(dict.deleted).toBe(1));
  });

  it('says where it comes from when it is not downloaded', async () => {
    dict.stored = false;
    render(<StoragePage provider="wasm" {...WASM} />);
    expect(await screen.findByText(/Downloaded when Japanese readings are turned on/)).toBeInTheDocument();
    expect(screen.queryByTestId('storage-delete-readings-ja')).toBeNull();
  });

  // PR review: Clear all empties the storage the dictionary lives in; the row must say so at once.
  it('says the dictionary is gone after Clear all', async () => {
    const { useModelStore } = await import('../../../stores/modelStore');
    const { useSegmentationStore } = await import('../../../stores/segmentationStore');
    const { useSmartTurnStore } = await import('../../../stores/smartTurnStore');
    const restore = { model: useModelStore.getState(), seg: useSegmentationStore.getState().refresh, turn: useSmartTurnStore.getState().refresh };
    useSegmentationStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
    useSmartTurnStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded' }, webgpuAvailable: true,
      deleteAllModels: vi.fn(async () => { dict.stored = false; }),
    });
    try {
      render(<StoragePage provider="wasm" {...WASM} />);
      await screen.findByTestId('storage-delete-readings-ja');
      fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      expect(await screen.findByText(/Downloaded when Japanese readings are turned on/)).toBeInTheDocument();
      expect(screen.queryByTestId('storage-delete-readings-ja')).toBeNull();
    } finally {
      useModelStore.setState({ modelStatuses: restore.model.modelStatuses, deleteAllModels: restore.model.deleteAllModels });
      useSegmentationStore.setState({ refresh: restore.seg });
      useSmartTurnStore.setState({ refresh: restore.turn });
    }
  });

  it('names its delete button', async () => {
    render(<StoragePage provider="wasm" {...WASM} />);
    expect(await screen.findByRole('button', { name: 'Delete: Readings dictionary (Japanese)' })).toBeInTheDocument();
  });
});
