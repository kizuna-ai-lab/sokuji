/**
 * SentenceSegmentationSection — the settings surface for the punctuation
 * stage: the on/off toggle, the 1-5 "sentences per bubble" control, and one
 * row per punctuation model (FireRedPunc, Edge-Punct-en, SaT 3L-SM).
 *
 * The settings store and the segmentation store are mocked with only the
 * hooks this component calls (house pattern, see HelpSection.test.tsx).
 * `modelForLanguage`, `MODEL_IDS`, `getManifestEntry` and `getModelSizeMb`
 * are pure and left real, the same way NativeDeviceControl.test.tsx leaves
 * `gpuTierAvailable` real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Provider } from '../../../types/Provider';
import type { PunctuationModelId } from '../../../lib/segmentation/SegmentationRuntime';
import type { PunctuationStatus } from '../../../lib/segmentation/PunctuationRuntime';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, d?: string) => (typeof d === 'string' ? d : _k),
    }),
  };
});

let mockSentenceSegmentation = true;
const setSentenceSegmentation = vi.fn();
let mockChunkSentences = 3;
const setChunkSentences = vi.fn();
let mockProvider: Provider = Provider.LOCAL_INFERENCE;
let mockLocalInferenceSlice: { sourceLanguage?: string; targetLanguage?: string } = {};

vi.mock('../../../stores/settingsStore', () => ({
  // The component reads the active pair by indexing the store with the
  // active provider's own settingsSliceKey (MainPanel.tsx:653's pattern) —
  // not through a hook, so the mock has to behave like the real store for
  // that one read: apply the selector to a fake state object.
  default: (selector: (s: unknown) => unknown) =>
    selector({ provider: mockProvider, localInference: mockLocalInferenceSlice }),
  useSentenceSegmentation: () => mockSentenceSegmentation,
  useSetSentenceSegmentation: () => setSentenceSegmentation,
  useSentenceSegmentationChunkSentences: () => mockChunkSentences,
  useSetSentenceSegmentationChunkSentences: () => setChunkSentences,
}));

type ModelStatesMap = Record<PunctuationModelId, { status: PunctuationStatus; percent: number; error: string | null }>;

const blankModelStates = (): ModelStatesMap => ({
  'fireredpunc': { status: 'not-downloaded', percent: 0, error: null },
  'edge-punct-en': { status: 'not-downloaded', percent: 0, error: null },
  'sat-3l-sm': { status: 'not-downloaded', percent: 0, error: null },
});

let modelStates: ModelStatesMap = blankModelStates();
const setModelStatus = vi.fn();
const setModelProgress = vi.fn();
const seedFromModelStatuses = vi.fn();

vi.mock('../../../stores/segmentationStore', () => ({
  useSegmentationModelState: (model: PunctuationModelId) => modelStates[model],
  useSegmentationStore: { getState: () => ({ setModelStatus, setModelProgress, seedFromModelStatuses }) },
}));

// Controllable so a fix-round test can force a download/delete to fail
// without touching real IndexedDB or the network.
const downloadModelMock = vi.fn();
vi.mock('../../../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: () => ({ downloadModel: downloadModelMock }) },
}));

// modelStore.deleteModel() is the real thing this section now routes Delete
// through (it needs no per-file progress, unlike download — see the file's
// own comment), and modelStore.setState() is what a successful/failed
// download refreshes afterward. Both mocked here rather than left real: the
// real store's own deleteModel/downloadModel/initialize touch IndexedDB via
// modelStorage, which jsdom has no implementation for at all
// (modelStore.test.ts mocks the same module for the same reason).
let mockModelStatuses: Record<string, string> = {};
const deleteModelStoreMock = vi.fn();
const modelStoreSetStateMock = vi.fn();
vi.mock('../../../stores/modelStore', () => ({
  useModelStatuses: () => mockModelStatuses,
  useModelStore: {
    getState: () => ({ deleteModel: deleteModelStoreMock }),
    setState: modelStoreSetStateMock,
  },
}));

const estimateStorageUsedBytesMock = vi.fn();
vi.mock('../../../lib/local-inference/modelStorage', () => ({
  estimateStorageUsedBytes: (...args: unknown[]) => estimateStorageUsedBytesMock(...args),
}));

const reportWarningMock = vi.fn();
vi.mock('../../../lib/diagnostics/report', () => ({
  reportWarning: reportWarningMock,
  describeCause: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { default: SentenceSegmentationSection } = await import('./SentenceSegmentationSection');

/** navigator.deviceMemory is undefined in jsdom by default, which the
 *  component (matching PunctuationRuntime's own fallback) reads as 4GB —
 *  i.e. low-memory. Every test but the low-memory one needs a value above
 *  the threshold, or every row would render disabled everywhere. */
function setDeviceMemory(gb: number | undefined): void {
  if (gb === undefined) {
    delete (navigator as { deviceMemory?: number }).deviceMemory;
  } else {
    Object.defineProperty(navigator, 'deviceMemory', { value: gb, configurable: true });
  }
}

const renderSection = (isSessionActive = false) =>
  render(<SentenceSegmentationSection isSessionActive={isSessionActive} />);

/** The shared ToggleSwitch renders role="switch" with no accessible name
 *  from content (the role doesn't support name-from-content), so — as
 *  LanguageSection.textOnly.test.tsx does — match on textContent instead of
 *  the `name` option. */
const segmentationToggle = () =>
  screen.getAllByRole('switch').find((el) => el.textContent?.includes('Subtitle segmentation'))!;

const chunkButton = (n: number) =>
  screen.getAllByText(String(n)).find((el) => el.tagName === 'BUTTON') as HTMLButtonElement;

const modelRow = (model: PunctuationModelId) =>
  screen.getByTestId(`sentence-segmentation-model-${model}`);

beforeEach(() => {
  cleanup();
  setDeviceMemory(8);
  mockSentenceSegmentation = true;
  setSentenceSegmentation.mockClear();
  mockChunkSentences = 3;
  setChunkSentences.mockClear();
  mockProvider = Provider.LOCAL_INFERENCE;
  mockLocalInferenceSlice = {};
  modelStates = blankModelStates();
  setModelStatus.mockClear();
  setModelProgress.mockClear();
  seedFromModelStatuses.mockClear();
  mockModelStatuses = {};
  deleteModelStoreMock.mockReset().mockResolvedValue(undefined);
  modelStoreSetStateMock.mockClear();
  estimateStorageUsedBytesMock.mockReset().mockResolvedValue(0);
  downloadModelMock.mockReset().mockResolvedValue('default');
  reportWarningMock.mockClear();
  localStorage.removeItem('debug:device-memory');
});

describe('SentenceSegmentationSection', () => {
  it('renders the section with id="sentence-segmentation-section"', () => {
    renderSection();
    expect(document.querySelector('#sentence-segmentation-section')).not.toBeNull();
  });

  it('the toggle reflects the setting and calls the setter on click', () => {
    mockSentenceSegmentation = false;
    renderSection();
    const toggle = segmentationToggle();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(setSentenceSegmentation).toHaveBeenCalledWith(true);
  });

  it('the five buttons render, the active one carries active, and clicking another calls the setter with that number', () => {
    mockChunkSentences = 3;
    renderSection();
    for (let n = 1; n <= 5; n++) {
      expect(chunkButton(n)).toBeTruthy();
    }
    expect(chunkButton(3).className).toMatch(/active/);
    expect(chunkButton(5).className).not.toMatch(/active/);

    fireEvent.click(chunkButton(5));
    expect(setChunkSentences).toHaveBeenCalledWith(5);
  });

  it('re-clicking the active button calls nothing', () => {
    mockChunkSentences = 3;
    renderSection();
    fireEvent.click(chunkButton(3));
    expect(setChunkSentences).not.toHaveBeenCalled();
  });

  it('toggling off disables the segmented control and the model rows', () => {
    mockSentenceSegmentation = false;
    renderSection();
    for (let n = 1; n <= 5; n++) {
      expect(chunkButton(n).disabled).toBe(true);
    }
    // Every model defaults to 'not-downloaded', so every row shows a
    // Download button — all three must be disabled too.
    const downloadButtons = screen.getAllByText('Download').map((el) => el.closest('button')!);
    expect(downloadButtons).toHaveLength(3);
    downloadButtons.forEach((btn) => expect(btn.disabled).toBe(true));
  });

  it('a model row shows its size in MB from the manifest', () => {
    renderSection();
    // punc.q8w.onnx + tokenizer.json + out_dict, summed and rounded down.
    expect(within(modelRow('fireredpunc')).getByText('155 MB')).toBeTruthy();
  });

  it('the row for the current source language is marked "used by current languages"', () => {
    mockLocalInferenceSlice = { sourceLanguage: 'zh' };
    renderSection();
    expect(within(modelRow('fireredpunc')).getByText('Used by current languages')).toBeTruthy();
    expect(within(modelRow('edge-punct-en')).queryByText('Used by current languages')).toBeNull();
  });

  it('the row for the current target language is marked "used by current languages"', () => {
    mockLocalInferenceSlice = { targetLanguage: 'ja' };
    renderSection();
    expect(within(modelRow('sat-3l-sm')).getByText('Used by current languages')).toBeTruthy();
    expect(within(modelRow('fireredpunc')).queryByText('Used by current languages')).toBeNull();
  });

  it('during a session, Delete on a model in use is disabled', () => {
    mockLocalInferenceSlice = { sourceLanguage: 'zh' };
    modelStates['fireredpunc'] = { status: 'downloaded', percent: 100, error: null };
    renderSection(true);
    const deleteBtn = within(modelRow('fireredpunc')).getByTitle('Delete');
    expect(deleteBtn).toHaveProperty('disabled', true);
  });

  it('on a low-memory device every row is greyed out with the reason', () => {
    setDeviceMemory(2);
    renderSection();
    expect(screen.getByText(/does not report enough memory/i)).toBeTruthy();
    const downloadButtons = screen.getAllByText('Download').map((el) => el.closest('button')!);
    expect(downloadButtons).toHaveLength(3);
    downloadButtons.forEach((btn) => expect(btn.disabled).toBe(true));
  });

  it('a model in error shows Retry', () => {
    modelStates['edge-punct-en'] = { status: 'error', percent: 0, error: 'download failed' };
    renderSection();
    expect(within(modelRow('edge-punct-en')).getByText('Retry')).toBeTruthy();
  });

  // Fix round 1: the low-memory gate must honour the same debug override
  // PunctuationRuntime.deviceMemoryGb() does, or a tester using it to check
  // THIS section sees it disagree with what the runtime actually does.
  it('a debug:device-memory override below the threshold forces low-memory even when navigator reports plenty', () => {
    setDeviceMemory(8);
    localStorage.setItem('debug:device-memory', '2');
    renderSection();
    expect(screen.getByText(/does not report enough memory/i)).toBeTruthy();
  });

  it('a debug:device-memory override above the threshold clears low-memory even when navigator reports too little', () => {
    setDeviceMemory(2);
    localStorage.setItem('debug:device-memory', '8');
    renderSection();
    expect(screen.queryByText(/does not report enough memory/i)).toBeNull();
  });

  // Fix round 1: a stored error must be visible, not just imply "something
  // went wrong" — the Retry button's title carries it (ModelManagementSection's
  // own error-button convention).
  it('a model in error carries its stored message as the Retry button title', () => {
    modelStates['edge-punct-en'] = { status: 'error', percent: 0, error: 'download failed: timeout' };
    renderSection();
    const retryBtn = within(modelRow('edge-punct-en')).getByText('Retry').closest('button')!;
    expect(retryBtn.getAttribute('title')).toBe('download failed: timeout');
  });

  // Fix round 1: a manually triggered download failure must reach the
  // diagnostic log the same way the runtime-driven one does
  // (useSegmentationRuntime.ts's onStatus('error') -> reportWarning), not
  // just flip the row to Retry with no trail.
  it('a failed download reports a warning and records the model as error', async () => {
    downloadModelMock.mockRejectedValueOnce(new Error('network down'));
    renderSection();
    const btn = within(modelRow('edge-punct-en')).getByText('Download').closest('button')!;
    fireEvent.click(btn);
    await vi.waitFor(() =>
      expect(setModelStatus).toHaveBeenCalledWith('edge-punct-en', 'error', 'network down'),
    );
    expect(reportWarningMock).toHaveBeenCalledWith(
      'Segmentation',
      expect.stringContaining('edge-punct-en'),
      expect.objectContaining({ dedupeKey: 'segmentation:edge-punct-en' }),
    );
  });

  // Fold-in fix: a failed delete must not become a silent unhandled
  // rejection either.
  it('a failed delete reports a warning instead of silently dropping it', async () => {
    modelStates['fireredpunc'] = { status: 'downloaded', percent: 100, error: null };
    deleteModelStoreMock.mockRejectedValueOnce(new Error('disk full'));
    renderSection();
    const btn = within(modelRow('fireredpunc')).getByTitle('Delete');
    fireEvent.click(btn);
    await vi.waitFor(() =>
      expect(reportWarningMock).toHaveBeenCalledWith(
        'Segmentation',
        expect.stringContaining('fireredpunc'),
        expect.objectContaining({ dedupeKey: 'segmentation:fireredpunc:delete' }),
      ),
    );
  });

  // Fix round 2, Important 2: model rows must reflect what modelStore already
  // knows is on disk, not the store's own always-'not-downloaded' placeholder.
  it('seeds segmentationStore from modelStore.useModelStatuses() on mount', () => {
    mockModelStatuses = { 'punct-zh-fireredpunc': 'downloaded' };
    renderSection();
    expect(seedFromModelStatuses).toHaveBeenCalledWith(mockModelStatuses);
  });

  // Fix round 2, Important 2: Delete has no per-file progress to carry, so —
  // unlike Download — it routes straight through useModelStore's own method
  // rather than ModelManager directly, so modelStatuses/storageUsedMb do not
  // drift the way the review found them doing.
  it('delete routes through useModelStore.deleteModel and clears segmentationStore on success', async () => {
    modelStates['fireredpunc'] = { status: 'downloaded', percent: 100, error: null };
    renderSection();
    const btn = within(modelRow('fireredpunc')).getByTitle('Delete');
    fireEvent.click(btn);
    await vi.waitFor(() => expect(deleteModelStoreMock).toHaveBeenCalledWith('punct-zh-fireredpunc'));
    expect(setModelStatus).toHaveBeenCalledWith('fireredpunc', 'not-downloaded');
  });

  // Fix round 2, Important 2: a successful download must refresh modelStore's
  // own modelStatuses and storageUsedMb (what StoragePage reads), not just
  // this section's own segmentationStore — download stays on ModelManager
  // directly for the per-file progress callback, but the review's whole point
  // was that nothing was keeping modelStore in sync with what that download
  // actually put on disk.
  it('a successful download refreshes modelStore\'s status and storage total', async () => {
    estimateStorageUsedBytesMock.mockResolvedValue(200 * 1024 * 1024);
    renderSection();
    const btn = within(modelRow('edge-punct-en')).getByText('Download').closest('button')!;
    fireEvent.click(btn);
    await vi.waitFor(() =>
      expect(modelStoreSetStateMock).toHaveBeenCalledWith(
        expect.objectContaining({ storageUsedMb: 200 }),
      ),
    );
    expect(modelStoreSetStateMock.mock.calls.some((call) => {
      const arg = call[0];
      if (typeof arg !== 'function') return false;
      const result = arg({ modelStatuses: {} });
      return result.modelStatuses?.['punct-en-edge'] === 'downloaded';
    })).toBe(true);
  });

  // Fix round 2, Important 2: a failed download must mark modelStore's own
  // status 'error' too, not just segmentationStore's — otherwise modelStore
  // still thinks a download is in flight after this section has already
  // given up and shown Retry.
  it('a failed download also marks modelStore\'s status error', async () => {
    downloadModelMock.mockRejectedValueOnce(new Error('network down'));
    renderSection();
    const btn = within(modelRow('edge-punct-en')).getByText('Download').closest('button')!;
    fireEvent.click(btn);
    await vi.waitFor(() => expect(setModelStatus).toHaveBeenCalledWith('edge-punct-en', 'error', 'network down'));
    expect(modelStoreSetStateMock.mock.calls.some((call) => {
      const arg = call[0];
      if (typeof arg !== 'function') return false;
      const result = arg({ modelStatuses: {} });
      return result.modelStatuses?.['punct-en-edge'] === 'error';
    })).toBe(true);
  });
});
