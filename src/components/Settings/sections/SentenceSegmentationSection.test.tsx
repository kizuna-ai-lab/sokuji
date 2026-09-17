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

vi.mock('../../../stores/segmentationStore', () => ({
  useSegmentationModelState: (model: PunctuationModelId) => modelStates[model],
  useSegmentationStore: { getState: () => ({ setModelStatus, setModelProgress }) },
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
});
