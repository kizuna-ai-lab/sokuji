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

// The session models in three small groups, one per stage (owner 2026-11-15): each shows what is on disk and the
// recommended ones this computer can run; the rest, other languages' last, in "N more" at the group's end.
const stageGroup = (name: string) => screen.getByRole('group', { name });
const more = (name: string) => fireEvent.click(within(stageGroup(name)).getByRole('button', { name: /more/ }));

describe('Models and storage — the session models', () => {
  it('splits the models this pair can use into recognition, translation and speech', () => {
    mount();
    const session = screen.getByRole('region', { name: /Models for the session/ });
    expect([...session.querySelectorAll('.models-stage__title')].map((t) => t.textContent)).toEqual(['Recognition', 'Translation', 'Speech']);
  });

  it('shows what is on disk and the recommended ones it can run; the rest wait under "N more"', () => {
    mount();
    const asr = stageGroup('Recognition');
    expect(within(asr).getByText('SenseVoice (int8)')).toBeInTheDocument();
    expect(within(asr).getByText('NeMo Parakeet TDT 0.6B (int8, 25 EU langs)')).toBeInTheDocument();
    expect(within(asr).queryByText('Moonshine Tiny EN (quantized)')).toBeNull();
    expect(within(asr).queryByText('Cohere Transcribe (WebGPU)')).toBeNull();
    more('Recognition');
    expect(within(asr).getByText('Moonshine Tiny EN (quantized)')).toBeInTheDocument();
    expect(within(asr).getByText('Cohere Transcribe (WebGPU)')).toBeInTheDocument();
  });

  it("puts the other languages' models last in the fold, under their own caption", () => {
    mount();
    expect(screen.queryByText('Opus-MT (en → de)')).toBeNull();
    more('Translation');
    const caption = within(stageGroup('Translation')).getByText(/Models for other languages/);
    const rows = [...stageGroup('Translation').querySelectorAll('.model-row__name')].map((n) => n.textContent);
    expect(rows).toContain('Opus-MT (en → de)');
    expect(caption.compareDocumentPosition(row('Opus-MT (en → de)')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the best one it can run when nothing on disk or recommended would be shown', () => {
    useModelStore.setState({ modelStatuses: {} } as never);
    mount();
    // Every recommended translation model needs WebGPU, which this computer lacks: one it can run stands in.
    expect(stageGroup('Translation').querySelectorAll('.models-stage__shown .model-row')).toHaveLength(1);
  });

  it('tags each row with its stage and says whether it is downloaded', () => {
    mount();
    expect(within(row('SenseVoice (int8)')).getByText('Recognition', { selector: '.model-row__tag' })).toBeInTheDocument();
    expect(within(row('SenseVoice (int8)')).getByText('Downloaded')).toBeInTheDocument();
    expect(within(row('Opus-MT (en → ja)')).getByText('Translation', { selector: '.model-row__tag' })).toBeInTheDocument();
    more('Recognition');
    expect(within(row('Moonshine Tiny EN (quantized)')).getByText('Not downloaded')).toBeInTheDocument();
  });

  it('downloads a model from its row, and cancels a download in progress', () => {
    useModelStore.setState({ downloads: { 'moonshine-tiny-ja-quant': { downloadedBytes: 1, totalBytes: 4, currentFile: 'a', percent: 25 } } } as never);
    mount();
    // A download in progress is shown without opening anything.
    const busy = row('Moonshine Tiny JA (quantized)');
    expect(within(busy).getByText('Downloading 25%')).toBeInTheDocument();
    fireEvent.click(within(busy).getByRole('button', { name: 'Cancel' }));
    expect(store.cancelDownload).toHaveBeenCalledWith('moonshine-tiny-ja-quant');
    more('Recognition');
    fireEvent.click(within(row('Moonshine Tiny EN (quantized)')).getByRole('button', { name: 'Download' }));
    expect(store.downloadModel).toHaveBeenCalledWith('moonshine-tiny-en-quant');
  });

  it('deletes a downloaded model after asking', async () => {
    mount();
    fireEvent.click(within(row('Opus-MT (en → ja)')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(row('Opus-MT (en → ja)')).getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(store.deleteModel).toHaveBeenCalledWith('opus-mt-en-jap'));
  });

  it('says a model this computer cannot run, and offers no download for it', () => {
    mount();
    more('Recognition');
    const gpu = row('Cohere Transcribe (WebGPU)');
    expect(within(gpu).getByText("This computer can't run it")).toBeInTheDocument();
    expect(within(gpu).queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('takes no download or delete during a session', () => {
    mount(true);
    expect(within(row('NeMo Parakeet TDT 0.6B (int8, 25 EU langs)')).getByRole('button', { name: 'Download' })).toBeDisabled();
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
    more('Recognition');
    const names = [...stageGroup('Recognition').querySelectorAll('.model-row__name')].map((n) => n.textContent);
    expect(names[0]).toBe('Moonshine Tiny JA (quantized)');
    expect(names.indexOf('SenseVoice (int8)')).toBeLessThan(names.indexOf('Cohere Transcribe (WebGPU)'));
  });

  it('writes a size in the unit that reads best', () => {
    mount();
    more('Recognition');
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
