// Models and storage — what is removed stops counting in the space shown.
// The stores' disk work is faked: each removal changes what the store says is on disk, as the real one does after
// measuring again (nativeModelStore.removeBundle reads the size again; modelStore.deleteModel recounts the storage).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor, act } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../lib/reading/ja/dictionary', () => ({ DICTIONARY_BYTES: 11_010_048, isDictionaryStored: async () => false, deleteDictionary: async () => {} }));
vi.mock('../../lib/local-inference/voiceStorage', () => ({ listVoices: async () => [], deleteVoice: async () => {} }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true,
}));
vi.mock('../Settings/sections/ModelImportModal', () => ({ ModelImportModal: () => null }));

import '../../locales';
import { ModelsPage } from './ModelsPage';
import { useModelStore } from '../../stores/modelStore';
import { useSmartTurnStore } from '../../stores/smartTurnStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';

const MB = 1_048_576;
const removeBundle = vi.fn(async () => { useNativeModelStore.setState({ bundleUsage: 0 } as never); });
const deleteModel = vi.fn(async (id: string) => {
  const statuses = { ...useModelStore.getState().modelStatuses, [id]: 'not_downloaded' };
  useModelStore.setState({ modelStatuses: statuses, storageUsedMb: 300 } as never);
});

beforeEach(() => {
  removeBundle.mockClear();
  deleteModel.mockClear();
  useLineUpStore.setState({ lineUp: null, stored: false } as never);
  useNativeModelStore.setState({
    bundleStatus: 'ready', bundleVersion: '0.31.2', bundleUsage: 3_435_973_837,
    refreshBundle: async () => {}, refreshBundleUsage: async () => {}, removeBundle,
  } as never);
  useModelStore.setState({
    initialized: true, webgpuAvailable: false, deviceFeatures: [], storageUsedMb: 2867,
    modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-jap': 'downloaded' },
    downloads: {}, downloadErrors: {}, deleteModel,
  } as never);
  useSmartTurnStore.setState({ phase: 'missing', downloadedBytes: 0, error: null, refresh: async () => {} } as never);
  useSegmentationStore.setState({ phase: 'missing', downloadedBytes: 0, error: null, refresh: async () => {} } as never);
});
afterEach(() => cleanup());

const mount = () => render(<ModelsPage locked={false} settings={LOCAL_INFERENCE_DEFAULTS} pair={{ source: 'ja', target: 'en' }} />);
const summary = () => document.querySelector('.models-page__summary') as HTMLElement;

describe('models and storage', () => {
  it('removes the on-device engine, and the space it took is no longer shown', async () => {
    mount();
    const group = await screen.findByRole('region', { name: 'On-device engine' });
    expect(group).toHaveTextContent('3.2 GB on disk');
    fireEvent.click(within(group).getByRole('button', { name: 'Remove: Engine 0.31.2' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Remove the on-device engine?' })).getByRole('button', { name: 'Yes' }));
    });
    expect(removeBundle).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'On-device engine' })).toBeNull());
  });

  it('deletes a model, and the count and the space in the summary go down', async () => {
    mount();
    expect(summary()).toHaveTextContent(`2 downloaded, ${(2867 * MB / 1024 ** 3).toFixed(1)} GB in all`);
    const card = screen.getByText('SenseVoice', { selector: '.model-card__name', exact: false }).closest('.model-card') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /Delete/ }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: /^Delete .*\?$/ })).getByRole('button', { name: 'Yes' }));
    });
    expect(deleteModel).toHaveBeenCalledWith('sensevoice-int8');
    await waitFor(() => expect(summary()).toHaveTextContent('1 downloaded, 300.0 MB in all'));
  });
});
