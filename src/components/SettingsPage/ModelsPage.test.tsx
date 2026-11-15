// "Models and storage" as the mock draws it (v18; the owner chose the mock, 2026-11-15): every model the
// "This device" service can use, downloaded or not, each with its own Download or Delete; the helper models;
// the imported voices; a summary line with Import and Clear all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
const dict = vi.hoisted(() => ({ stored: true, deleteDictionary: vi.fn(async () => {}) }));
vi.mock('../../lib/reading/ja/dictionary', () => ({
  DICTIONARY_BYTES: 11_010_048,
  isDictionaryStored: async () => dict.stored,
  deleteDictionary: dict.deleteDictionary,
}));
const voices = vi.hoisted(() => ({
  list: [] as Array<{ id: number; engine: 'supertonic-3'; name: string; jsonData: Blob; importedAt: number }>,
  deleteVoice: vi.fn(async (_id: number) => {}),
}));
vi.mock('../../lib/local-inference/voiceStorage', () => ({
  listVoices: async () => voices.list,
  deleteVoice: voices.deleteVoice,
}));
vi.mock('../Settings/sections/ModelImportModal', () => ({
  ModelImportModal: ({ modelName }: { modelName: string }) => <div data-testid="import-modal">{modelName}</div>,
}));

import { ModelsPage } from './ModelsPage';
import { useModelStore } from '../../stores/modelStore';
import { useSmartTurnStore } from '../../stores/smartTurnStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';

const store = {
  downloadModel: vi.fn(async (_id: string) => {}),
  cancelDownload: vi.fn((_id: string) => {}),
  deleteModel: vi.fn(async (_id: string) => {}),
  deleteAllModels: vi.fn(async () => {}),
};
const turn = { download: vi.fn(async () => {}), remove: vi.fn(async () => {}), refresh: vi.fn(async () => {}) };
const punct = { download: vi.fn(async () => {}), cancel: vi.fn(), deleteModels: vi.fn(async () => {}), refresh: vi.fn(async () => {}) };

beforeEach(() => {
  for (const f of [...Object.values(store), ...Object.values(turn), ...Object.values(punct), dict.deleteDictionary, voices.deleteVoice]) f.mockClear();
  dict.stored = true;
  voices.list = [];
  useModelStore.setState({
    initialized: true, webgpuAvailable: false, deviceFeatures: [], storageUsedMb: 2867,
    modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-jap': 'downloaded' },
    downloads: {}, downloadErrors: {},
    ...store,
  } as never);
  useSmartTurnStore.setState({ phase: 'ready', downloadedBytes: 0, error: null, ...turn } as never);
  useSegmentationStore.setState({ phase: 'missing', downloadedBytes: 0, error: null, ...punct } as never);
});
afterEach(() => cleanup());

const mount = (locked = false) =>
  render(<ModelsPage locked={locked} settings={LOCAL_INFERENCE_DEFAULTS} pair={{ source: 'ja', target: 'en' }} />);
const row = (name: string) => screen.getByText(name).closest('.model-row') as HTMLElement;

describe('Models and storage — the session models', () => {
  it('lists what this pair can use, downloaded or not, under the "This device" group', () => {
    mount();
    const group = screen.getByRole('region', { name: /Models for the session/ });
    expect(within(group).getByText('SenseVoice (int8)')).toBeInTheDocument();
    expect(within(group).getByText('Opus-MT (en → ja)')).toBeInTheDocument();
    expect(within(group).getByText('Moonshine Tiny EN (quantized)')).toBeInTheDocument();
    // Korean only, German only: not for ja ⇄ en, so folded away.
    expect(within(group).queryByText('Moonshine Tiny KO (quantized)')).toBeNull();
    expect(within(group).queryByText('Opus-MT (en → de)')).toBeNull();
  });

  it('keeps the other languages\' models in a fold at the end', () => {
    mount();
    const fold = screen.getByRole('button', { name: /Models for other languages/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(fold);
    expect(screen.getByText('Opus-MT (en → de)')).toBeInTheDocument();
  });

  it('tags each row with its stage and says whether it is downloaded', () => {
    mount();
    expect(within(row('SenseVoice (int8)')).getByText('Recognition')).toHaveClass('model-row__tag');
    expect(within(row('SenseVoice (int8)')).getByText('Downloaded')).toBeInTheDocument();
    expect(within(row('Opus-MT (en → ja)')).getByText('Translation')).toBeInTheDocument();
    expect(within(row('Moonshine Tiny EN (quantized)')).getByText('Not downloaded')).toBeInTheDocument();
  });

  it('downloads a model from its row, and cancels a download in progress', () => {
    useModelStore.setState({ downloads: { 'moonshine-tiny-ja-quant': { downloadedBytes: 1, totalBytes: 4, currentFile: 'a', percent: 25 } } } as never);
    mount();
    fireEvent.click(within(row('Moonshine Tiny EN (quantized)')).getByRole('button', { name: 'Download' }));
    expect(store.downloadModel).toHaveBeenCalledWith('moonshine-tiny-en-quant');
    const busy = row('Moonshine Tiny JA (quantized)');
    expect(within(busy).getByText('Downloading 25%')).toBeInTheDocument();
    fireEvent.click(within(busy).getByRole('button', { name: 'Cancel' }));
    expect(store.cancelDownload).toHaveBeenCalledWith('moonshine-tiny-ja-quant');
  });

  it('deletes a downloaded model after asking', async () => {
    mount();
    fireEvent.click(within(row('Opus-MT (en → ja)')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(row('Opus-MT (en → ja)')).getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(store.deleteModel).toHaveBeenCalledWith('opus-mt-en-jap'));
  });

  it('says a model this computer cannot run, and offers no download for it', () => {
    mount();
    const gpu = row('Cohere Transcribe (WebGPU)');
    expect(within(gpu).getByText("This computer can't run it")).toBeInTheDocument();
    expect(within(gpu).queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('takes no download or delete during a session', () => {
    mount(true);
    expect(within(row('Moonshine Tiny EN (quantized)')).getByRole('button', { name: 'Download' })).toBeDisabled();
    expect(within(row('SenseVoice (int8)')).getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('Models and storage — the helper models', () => {
  it('manages Smart Turn here: Delete when it is on disk, Download when not', async () => {
    const first = mount();
    fireEvent.click(within(row('Smart Turn v3.2')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(row('Smart Turn v3.2')).getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(turn.remove).toHaveBeenCalled());
    first.unmount();
    useSmartTurnStore.setState({ phase: 'missing' } as never);
    mount();
    fireEvent.click(within(row('Smart Turn v3.2')).getByRole('button', { name: 'Download' }));
    expect(turn.download).toHaveBeenCalled();
  });

  it('downloads the three punctuation models together, as one row', () => {
    mount();
    const pack = screen.getByText(/Edge-Punct-Casing/).closest('.model-row') as HTMLElement;
    expect(within(pack).getByText('Sentences and punctuation')).toBeInTheDocument();
    fireEvent.click(within(pack).getByRole('button', { name: 'Download' }));
    expect(punct.download).toHaveBeenCalled();
  });

  it('keeps the Japanese readings dictionary here: deleted from its row, downloaded from Display', async () => {
    const first = mount();
    const dictRow = await screen.findByText('Readings dictionary (Japanese)');
    fireEvent.click(within(dictRow.closest('.model-row') as HTMLElement).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(dictRow.closest('.model-row') as HTMLElement).getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(dict.deleteDictionary).toHaveBeenCalled());
    first.unmount();
    dict.stored = false;
    mount();
    expect(await screen.findByText('Downloaded when Japanese readings are turned on in Display.')).toBeInTheDocument();
  });
});

describe('Models and storage — imported voices and the summary', () => {
  it('lists the imported voices, each deleted from its row', async () => {
    voices.list = [{ id: 4, engine: 'supertonic-3', name: 'My voice 1', jsonData: new Blob(['x'.repeat(300_000)]), importedAt: Date.UTC(2026, 10, 2) }];
    mount();
    const voice = (await screen.findByText('My voice 1')).closest('.model-row') as HTMLElement;
    expect(within(voice).getByText('Voice')).toBeInTheDocument();
    fireEvent.click(within(voice).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(voice).getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(voices.deleteVoice).toHaveBeenCalledWith(4));
  });

  it('has no voices group without imported voices', async () => {
    mount();
    await screen.findByText('Readings dictionary (Japanese)');
    expect(screen.queryByRole('region', { name: /Imported voices/ })).toBeNull();
  });

  it('counts what is downloaded and how much room it takes', async () => {
    mount();
    // SenseVoice, Opus-MT en→ja, Smart Turn, the dictionary.
    expect(await screen.findByText('4 downloaded, 2.8 GB in all')).toBeInTheDocument();
  });

  it('says so when nothing is downloaded, and offers no Clear all', async () => {
    useModelStore.setState({ modelStatuses: {}, storageUsedMb: 0 } as never);
    useSmartTurnStore.setState({ phase: 'missing' } as never);
    dict.stored = false;
    mount();
    expect(await screen.findByText('No models downloaded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('lists what is on disk first, then what this computer can run, then what it cannot', () => {
    useModelStore.setState({ modelStatuses: { 'moonshine-tiny-ja-quant': 'downloaded' } } as never);
    mount();
    const names = [...screen.getByRole('region', { name: /Models for the session/ }).querySelectorAll('.model-row__name')].map((n) => n.textContent);
    expect(names[0]).toBe('Moonshine Tiny JA (quantized)');
    expect(names.indexOf('SenseVoice (int8)')).toBeLessThan(names.indexOf('Cohere Transcribe (WebGPU)'));
  });

  it('writes a size in the unit that reads best', () => {
    mount();
    expect(within(row('Cohere Transcribe (WebGPU)')).getByText(/\d\.\d GB/)).toBeInTheDocument();
  });

  it('clears everything after asking, and tells the helper models\' own stores', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(store.deleteAllModels).toHaveBeenCalled());
    await waitFor(() => expect(punct.refresh).toHaveBeenCalled());
    expect(turn.refresh).toHaveBeenCalled();
  });

  it('imports a model from files: pick the model, then its files', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Import a model from files' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a model to import' }), { target: { value: 'opus-mt-en-de' } });
    expect(screen.getByTestId('import-modal')).toHaveTextContent('Opus-MT (en → de)');
  });
});
