/**
 * Tests for the NativeModelManagementSection variant card UI (Task 9).
 *
 * Two states under test:
 *   1. Pre-download  — supported variants shown with sizes + recommended badge;
 *                      unsupported variants not offered.
 *   2. Post-download — collapses to the single resolved variant label + actual size;
 *                      no individual variant chooser buttons.
 *
 * Follows the TierIcon.test.tsx idiom: render, query, assert — no snapshot files.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { NativeModelManagementSection } from './NativeModelManagementSection';
import { formatMemMb } from '../../../lib/local-inference/native/nativeCatalog';
import type { VariantInfo, NativeModelInfo } from '../../../lib/local-inference/native/nativeProtocol';

// The Supertonic-shaped style-import path (Task 13) goes through voiceStorage
// (not nativeVoiceStorage, which backs the MOSS clip-clone path). Mocked so
// NativeVoiceSection's injected store resolves imported voices without a real
// IndexedDB (jsdom has none here, unlike nativeVoiceStorage.test.tsx which
// polyfills it via fake-indexeddb/auto).
vi.mock('../../../lib/local-inference/voiceStorage', () => ({
  listVoices: vi.fn().mockResolvedValue([{ id: 3, name: 'MyVoice', jsonData: new Blob(['{}']) }]),
  addVoice: vi.fn(),
  renameVoice: vi.fn(),
  deleteVoice: vi.fn(),
  getVoice: vi.fn(),
  VoiceImportError: class extends Error {},
}));

// ---------------------------------------------------------------------------
// Stable mock data (names start with "mock" so vitest hoists them alongside vi.mock)
// ---------------------------------------------------------------------------

const mockSettings = {
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  asrDevice: 'auto' as const,
  translationDevice: 'auto' as const,
  ttsDevice: 'auto' as const,
  // Auto (empty) by default — none of the fixture/download-state-independent
  // tests below need an explicit pick; individual tests set an entry here
  // (mirroring the old per-test flat-field mutation) when they need one.
  selections: {} as Record<string, { asr: { modelId: string; variant?: string };
    translation: { modelId: string; variant?: string }; tts: { modelId: string; variant?: string } }>,
};

// Fixture catalog — must start with "mock" so vitest hoists it with vi.mock factories.
// Contains the minimum set of models needed to render all cards exercised by the 8
// failing tests: a ja-compatible ASR model, three multilingual translate models (incl.
// both hy-mt* IDs that trigger the variant-picker gate), and two en TTS models (Amy
// piper + MOSS voice-cloning).
const mockCatalog: Record<string, NativeModelInfo> = {
  'sense-voice': {
    id: 'sense-voice',
    name: 'SenseVoice',
    languages: ['ja', 'en', 'zh', 'ko'],
    recommended: true,
    tiers: [],
    order: 0,
    repo: 'sense-voice',
    kind: 'asr',
    sizeBytes: 944624033,
  },
  'qwen2.5-0.5b': {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5 0.5B',
    languages: ['multi'],
    recommended: true,
    tiers: [],
    order: 0,
    repo: 'qwen2.5-0.5b',
    kind: 'translate',
    sizeBytes: 999604126,
  },
  'hy-mt2-7b': {
    id: 'hy-mt2-7b',
    name: 'HY-MT2 7B',
    languages: ['multi'],
    recommended: false,
    tiers: [],
    order: 1,
    repo: 'hy-mt2-7b',
    kind: 'translate',
    sizeBytes: 16075624007,
    variantIds: ['q4_k_m', 'q8_0'],
    variants: [
      { id: 'q4_k_m', sizeBytes: 8e9, repo: 'tencent/Hy-MT2-7B-GGUF/Hy-MT2-7B-Q4_K_M.gguf',
        supported: true, recommended: true },
      { id: 'q8_0', sizeBytes: 15e9, repo: 'tencent/Hy-MT2-7B-GGUF/HY-MT2-7B-Q8_0.gguf',
        supported: false, recommended: false },
    ],
  },
  'hy-mt15-7b': {
    id: 'hy-mt15-7b',
    name: 'HY-MT1.5 7B',
    languages: ['multi'],
    recommended: false,
    tiers: [],
    order: 2,
    repo: 'hy-mt15-7b',
    kind: 'translate',
    sizeBytes: 16075608305,
    variantIds: ['q4_k_m', 'q8_0'],
    variants: [
      { id: 'q4_k_m', sizeBytes: 8e9, repo: 'tencent/HY-MT1.5-7B-GGUF/HY-MT1.5-7B-Q4_K_M.gguf',
        supported: true, recommended: true },
      { id: 'q8_0', sizeBytes: 15e9, repo: 'tencent/HY-MT1.5-7B-GGUF/HY-MT1.5-7B-Q8_0.gguf',
        supported: false, recommended: false },
    ],
  },
  'csukuangfj/vits-piper-en_US-amy-low': {
    id: 'csukuangfj/vits-piper-en_US-amy-low',
    name: 'Amy (Piper EN)',
    languages: ['en'],
    recommended: true,
    tiers: [],
    order: 0,
    repo: 'csukuangfj/vits-piper-en_US-amy-low',
    kind: 'tts',
    numSpeakers: 1,
    sizeBytes: 81105784,
  },
  'moss-tts-nano': {
    id: 'moss-tts-nano',
    name: 'MOSS TTS Nano',
    languages: ['en', 'zh', 'ja'],
    recommended: false,
    tiers: [],
    order: 1,
    repo: 'moss-tts-nano',
    kind: 'tts',
    numSpeakers: 1,
    clones: true,
    streaming: true,
    sizeBytes: 763206064,
  },
  'supertonic-3': {
    id: 'supertonic-3',
    name: 'Supertonic 3',
    languages: ['en'],
    recommended: false,
    tiers: [],
    order: 2,
    repo: 'supertonic-3',
    kind: 'tts',
    numSpeakers: 1,
    voice: { builtin: 'named', custom: 'style' },
    sizeBytes: 100000000,
  },
  // Multi-variant TTS card (Task 10) — same shape as the hy-mt2-7b translation
  // fixture above, gating the quant-variant picker on a TTS card.
  'qwen3-tts-1.7b': {
    id: 'qwen3-tts-1.7b',
    name: 'Qwen3 TTS 1.7B',
    languages: ['en'],
    recommended: false,
    tiers: [],
    order: 3,
    repo: 'qwen3-tts-1.7b',
    kind: 'tts',
    numSpeakers: 1,
    sizeBytes: 3600000000,
    variantIds: ['bf16', 'fp32', 'int8'],
    variants: [
      { id: 'bf16', sizeBytes: 3.6e9, repo: 'org/qwen3-tts-1.7b-bf16', supported: true, recommended: true },
      { id: 'fp32', sizeBytes: 7.2e9, repo: 'org/qwen3-tts-1.7b-fp32', supported: true, recommended: false },
      { id: 'int8', sizeBytes: 1.9e9, repo: 'org/qwen3-tts-1.7b-int8', supported: false, recommended: false },
    ],
  },
};

const mockVariants: VariantInfo[] = [
  {
    id: 'q4_k_m',
    computeType: 'q4_k_m',
    repo: 'tencent/Hy-MT2-7B-GGUF/Hy-MT2-7B-Q4_K_M.gguf',
    sizeBytes: 8e9,
    supported: true,
    reason: 'fits in budget',
  },
  {
    id: 'q8_0',
    computeType: 'q8_0',
    repo: 'tencent/Hy-MT2-7B-GGUF/HY-MT2-7B-Q8_0.gguf',
    sizeBytes: 15e9,
    supported: false,
    reason: 'exceeds budget',
  },
];

let mockCatalogOverride: typeof mockCatalog | null = null;

// Mutable store state — mutated per test in beforeEach
const mockStatuses: Record<string, string> = {};
const mockSizes: Record<string, number> = {};
// mockTtsResolved starts with "mock" so vitest hoists it with vi.mock; reassigned per test.
let mockTtsResolved: { model: string; device: string; rtf?: number } | null = null;
// mockSidecarStatus starts with "mock" so vitest hoists it alongside vi.mock factories.
let mockSidecarStatus = 'ready';

const mockListVariants = vi.fn();
const mockDownload = vi.fn();
const mockDeleteModel = vi.fn();
const mockUpdate = vi.fn();
const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockSetStatusRepos = vi.fn();
const mockRetrySidecar = vi.fn();

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

// Tooltip uses FloatingPortal which causes jsdom issues; replace with a passthrough
// that also surfaces `content` inline (unconditionally, unlike the real hover-gated
// tooltip) so tests can assert on tooltip content without simulating hover/floating-ui.
vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
    <>{children}{content}</>
  ),
}));

vi.mock('../../../stores/settingsStore', () => ({
  useLocalNativeSettings: () => mockSettings,
  useUpdateLocalNative: () => mockUpdate,
}));

// Lightweight stand-in for the real selection resolver: an explicit,
// catalog-known, 'ready' pick resolves (with its variant passed through);
// anything else (auto, unready, or an id the mock catalog doesn't carry)
// resolves to null. Mirrors resolveStage's explicit-branch gate closely
// enough for the UI-wiring behavior these tests exercise (card highlighting,
// the voice picker's selected-card embedding) without reimplementing
// language/hardware compatibility.
const mockResolve = (src: string, tgt: string, selections: typeof mockSettings.selections) => {
  const catalog = mockCatalogOverride ?? mockCatalog;
  const d = selections?.[`${src}→${tgt}`];
  const pick = (stage: 'asr' | 'translation' | 'tts') => {
    const sel = d?.[stage];
    if (!sel?.modelId || !catalog[sel.modelId] || mockStatuses[sel.modelId] !== 'ready') return null;
    return { modelId: sel.modelId, variant: sel.variant, source: 'explicit' as const };
  };
  return { asr: pick('asr'), translation: pick('translation'), tts: pick('tts'), notes: [], prunes: [] };
};

vi.mock('../../../stores/nativeModelStore', () => {
  const mockStoreState = () => ({
    statuses: mockStatuses,
    sizes: mockSizes,
    progress: {},
    errors: {},
    catalog: mockCatalog,
    resolve: mockResolve,
    sidecarStatus: mockSidecarStatus,
    download: mockDownload,
    deleteModel: mockDeleteModel,
    cancelDownload: vi.fn(),
    refresh: mockRefresh,
    refreshCatalog: vi.fn().mockResolvedValue(undefined),
    setStatusRepos: mockSetStatusRepos,
    autoSelect: vi.fn().mockReturnValue(null),
    retrySidecar: mockRetrySidecar,
    asrLoading: false,
    asrResolved: null,
    translationResolved: null,
  });
  const useNativeModelStore = Object.assign(
    (sel: Function) => sel(mockStoreState()),
    { getState: () => mockStoreState() },
  );
  return {
    useNativeModelStore,
    useNativeModelStatuses: () => ({ ...mockStatuses }),
    useNativeModelProgress: () => ({}),
    useNativeModelSizes: () => ({ ...mockSizes }),
    useNativeModelErrors: () => ({}),
    useNativeCatalog: () => mockCatalogOverride ?? mockCatalog,
    useNativeAsrLoading: () => false,
    useNativeAsrResolved: () => null,
    useNativeTranslationResolved: () => null,
    useNativeTtsResolved: () => mockTtsResolved,
    useNativeSidecarStatus: () => mockSidecarStatus,
    nativeListVariants: (...args: unknown[]) => mockListVariants(...args),
    nativeListTtsVoices: () => Promise.resolve([]),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset mutable state so tests are independent.
  Object.keys(mockStatuses).forEach((k) => delete mockStatuses[k]);
  Object.keys(mockSizes).forEach((k) => delete mockSizes[k]);
  mockTtsResolved = null;
  mockSidecarStatus = 'ready';
  mockListVariants.mockResolvedValue({ variants: mockVariants, recommended: 'q4_k_m' });
  mockDownload.mockReset();
  mockDeleteModel.mockReset();
  mockUpdate.mockReset();
  mockRefresh.mockReset();
  mockRefresh.mockResolvedValue(undefined);
  mockSetStatusRepos.mockReset();
  mockRetrySidecar.mockReset();
});

describe('NativeModelManagementSection — HY-MT2 variant card', () => {
  it('header dropdown is a select whose value is the chosen variant; rows list supported (enabled) and unsupported (disabled) variants', async () => {
    // All statuses absent (default) → pre-download state for hy-mt2-7b.
    render(<NativeModelManagementSection />);
    const q4SizeLabel = formatMemMb(Math.round(8e9 / 1e6));

    // The compact dropdown in the header is a customizable <select>
    // (appearance: base-select — this section is Electron-only, Chromium 144);
    // its value is the chosen variant id, and <selectedcontent> mirrors the
    // chosen option's label + size into the closed control.
    const dd = await waitFor(() => {
      const card = screen.getByTestId('model-card-hy-mt2-7b');
      return within(card).getByTestId('variant-dd-hy-mt2-7b') as HTMLSelectElement;
    });
    expect(dd.value).toBe('q4_k_m');

    // Options live inside the select from the start — the picker is a
    // top-layer popup, so listing them never grows the card (which is what
    // the old menu's lazy render existed to prevent).
    const card7b = screen.getByTestId('model-card-hy-mt2-7b');
    const q4Row = within(card7b).getByTestId('variant-row-q4_k_m');
    expect(q4Row).toHaveTextContent('Q4_K_M');
    expect(q4Row).toHaveTextContent(q4SizeLabel);
    expect(within(q4Row).getByText('recommended')).toBeInTheDocument();
    expect(q4Row).toBeEnabled();

    // q8_0 is unsupported → listed (so the user sees the option) but disabled;
    // its actual reason is spelled out inline in the row — the old hover
    // tooltip can't render above the select's top-layer picker, and inline
    // beats hover-only anyway.
    const q8Row = within(card7b).getByTestId('variant-row-q8_0');
    expect(q8Row).toBeDisabled();
    expect(q8Row).toHaveTextContent('GPU memory');
  });

  it('changing the select to an unsupported variant is a no-op', async () => {
    // A real picker never lets a disabled option through; this guards the
    // programmatic/keyboard path — pinning must itself check support, the
    // way the old menu's click handler no-opped on unsupported rows.
    // (The positive pin path is covered on the TTS card below, where a
    // second supported variant exists to change to.)
    render(<NativeModelManagementSection />);
    const dd = await waitFor(() =>
      within(screen.getByTestId('model-card-hy-mt2-7b')).getByTestId('variant-dd-hy-mt2-7b'));

    fireEvent.change(dd, { target: { value: 'q8_0' } });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('HY-MT1.5 cards also expose the quant-variant picker (the gate is data-driven variantIds, not a hy-mt2-only special case)', async () => {
    render(<NativeModelManagementSection />);
    // hy-mt15-7b is a multilingual card always present; its catalog entry carries
    // variantIds too, so it fetches variants and shows the same Q4_K_M dropdown as hy-mt2.
    const dd = await waitFor(() =>
      within(screen.getByTestId('model-card-hy-mt15-7b')).getByTestId('variant-dd-hy-mt15-7b')) as HTMLSelectElement;
    expect(dd.value).toBe('q4_k_m');
  });

  it('collapses to resolved variant label after download; no variant chooser buttons', async () => {
    // Mark hy-mt2-7b as downloaded with a known byte count.
    const downloadedBytes = 8_000_000_000;
    mockStatuses['hy-mt2-7b'] = 'ready';
    mockSizes['hy-mt2-7b'] = downloadedBytes;

    render(<NativeModelManagementSection />);

    // The resolved label appears only after the async listVariants effect resolves
    // and sets variantData, triggering a re-render with the resolved computeType.
    const downloadedSizeLabel = formatMemMb(Math.round(downloadedBytes / 1e6));
    const resolvedSpan = await waitFor(() => {
      const card = screen.getByTestId('model-card-hy-mt2-7b');
      return within(card).getByTestId('variant-resolved-hy-mt2-7b');
    });

    expect(resolvedSpan).toHaveTextContent('Q4_K_M');
    expect(resolvedSpan).toHaveTextContent(downloadedSizeLabel);

    // No variant chooser buttons should appear on the hy-mt2-7b card after download.
    const card7b = screen.getByTestId('model-card-hy-mt2-7b');
    expect(within(card7b).queryByTestId('variant-row-q4_k_m')).not.toBeInTheDocument();
    expect(within(card7b).queryByTestId('variant-row-q8_0')).not.toBeInTheDocument();
  });

  it('deletes the resolved variant repo, not the default (Q4_K_M-only download is removable)', async () => {
    // Downloaded state: the card collapses to the resolved variant and shows Delete.
    mockStatuses['hy-mt2-7b'] = 'ready';
    mockSizes['hy-mt2-7b'] = 8_000_000_000;

    render(<NativeModelManagementSection />);
    const card7b = await waitFor(() => {
      const c = screen.getByTestId('model-card-hy-mt2-7b');
      within(c).getByTestId('variant-resolved-hy-mt2-7b'); // throws until variant data lands
      return c;
    });

    fireEvent.click(within(card7b).getByRole('button', { name: /Delete/i }));

    // Delete must target the Q4_K_M repo so the Q4_K_M cache is actually freed.
    expect(mockDeleteModel).toHaveBeenCalledWith('hy-mt2-7b', 'tencent/Hy-MT2-7B-GGUF/Hy-MT2-7B-Q4_K_M.gguf');
  });

  it('does not push an empty statusRepos override when the catalog has no variant data', async () => {
    // Variant metadata now arrives WITH the catalog; a catalog whose entries
    // carry no `variants` (e.g. an older sidecar) must not produce an empty {}
    // override (which would defeat the store's `repos ?? cache` fallback and
    // mask an already-downloaded non-default quant).
    const stripped = Object.fromEntries(Object.entries(mockCatalog).map(
      ([k, v]) => [k, { ...(v as object), variants: undefined }])) as typeof mockCatalog;
    mockCatalogOverride = stripped;

    render(<NativeModelManagementSection />);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());

    expect(mockRefresh.mock.calls.every(([, repos]) => repos === undefined)).toBe(true);
    expect(mockSetStatusRepos).not.toHaveBeenCalled();
    mockCatalogOverride = null;
  });

  it('downloads the chosen (recommended Q4_K_M) variant repo, not the default', async () => {
    // Pre-download state for hy-mt2-7b; Q4_K_M is recommended.
    render(<NativeModelManagementSection />);

    // Wait for the variant data to land so the download button knows the chosen repo.
    const card7b = await waitFor(() => {
      const c = screen.getByTestId('model-card-hy-mt2-7b');
      within(c).getByTestId('variant-dd-hy-mt2-7b'); // throws until variant data lands
      return c;
    });

    // Click the card's Download button.
    const downloadBtn = within(card7b).getByRole('button', { name: /Download/i });
    fireEvent.click(downloadBtn);

    // Download must be called with the model's catalog id AND the Q4_K_M variant's repo.
    expect(mockDownload).toHaveBeenCalledWith('hy-mt2-7b', 'tencent/Hy-MT2-7B-GGUF/Hy-MT2-7B-Q4_K_M.gguf');
  });
});

describe('NativeModelManagementSection — TTS multi-variant card (Task 10)', () => {
  // qwen3-tts-1.7b (mockCatalog) mirrors hy-mt2-7b's shape but with kind:'tts' —
  // this exercises the TTS renderCards call, which previously passed undefined for
  // variantMap/onPin (the picker was translation/ASR-only before this task).
  it('the picker renders on a multi-variant TTS card (same as ASR/translation)', async () => {
    render(<NativeModelManagementSection />);
    const bf16SizeLabel = formatMemMb(Math.round(3.6e9 / 1e6));

    const dd = await waitFor(() => {
      const card = screen.getByTestId('model-card-qwen3-tts-1.7b');
      return within(card).getByTestId('variant-dd-qwen3-tts-1.7b') as HTMLSelectElement;
    });
    expect(dd.value).toBe('bf16');
    const bf16Row = within(screen.getByTestId('model-card-qwen3-tts-1.7b')).getByTestId('variant-row-bf16');
    expect(bf16Row).toHaveTextContent('BF16');
    expect(bf16Row).toHaveTextContent(bf16SizeLabel);
  });

  it('pinning a supported variant on a TTS card writes it into that stage\'s selection', async () => {
    render(<NativeModelManagementSection />);
    const dd = await waitFor(() =>
      within(screen.getByTestId('model-card-qwen3-tts-1.7b')).getByTestId('variant-dd-qwen3-tts-1.7b'));

    fireEvent.change(dd, { target: { value: 'fp32' } });

    // The pin reaches settings on the (direction, stage) selection alongside
    // its modelId — there is no separate map for it to live in, so pinning a
    // variant necessarily also makes that card the stage's active pick.
    expect(mockUpdate).toHaveBeenCalledWith({
      selections: {
        'ja→en': {
          asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'qwen3-tts-1.7b', variant: 'fp32' },
        },
      },
    });
  });

  it('downloads the chosen (recommended BF16) variant repo for a TTS card, not the default', async () => {
    render(<NativeModelManagementSection />);
    const card = await waitFor(() => {
      const c = screen.getByTestId('model-card-qwen3-tts-1.7b');
      within(c).getByTestId('variant-dd-qwen3-tts-1.7b'); // throws until variant data lands
      return c;
    });

    const downloadBtn = within(card).getByRole('button', { name: /Download/i });
    fireEvent.click(downloadBtn);

    expect(mockDownload).toHaveBeenCalledWith('qwen3-tts-1.7b', 'org/qwen3-tts-1.7b-bf16');
  });
});

describe('NativeModelManagementSection — TTS model card resolved badge', () => {
  // The live-resolved badge is driven by ttsResolved (session telemetry)
  // matching a card's id directly — independent of which card resolve()
  // currently treats as "selected" — so this describe block needs no
  // explicit selections entry.
  const AMY_ID = 'csukuangfj/vits-piper-en_US-amy-low';

  it('shows the live device badge on the Amy card when ttsResolved matches its id', () => {
    mockTtsResolved = { model: AMY_ID, device: 'cpu', rtf: 0.44 };

    render(<NativeModelManagementSection />);

    // The Amy card must exist in the TTS group.
    const amyCard = screen.getByTestId(`model-card-${AMY_ID}`);

    // The resolved badge must appear (device chip with --live CSS class).
    const liveBadge = amyCard.querySelector('.model-card__lang-tag--live');
    expect(liveBadge).not.toBeNull();

    // Badge text must include "CPU" (from tierLabel('cpu').label).
    expect(liveBadge).toHaveTextContent('CPU');
  });

  it('shows no live badge on TTS cards when ttsResolved is null', () => {
    mockTtsResolved = null;

    render(<NativeModelManagementSection />);

    // The whole TTS section must not contain any live badge.
    const ttsSection = document.getElementById('model-tts-section')!;
    expect(ttsSection).not.toBeNull();
    expect(ttsSection.querySelector('.model-card__lang-tag--live')).toBeNull();
  });
});

describe('NativeModelManagementSection — sidecar lifecycle states', () => {
  it('shows a starting placeholder while the sidecar warms', () => {
    mockSidecarStatus = 'starting';
    render(<NativeModelManagementSection />);
    expect(screen.getByText(/starting the local engine/i)).toBeInTheDocument();
  });

  it('renders nothing when the sidecar is unavailable (EngineSection owns the error)', () => {
    mockSidecarStatus = 'unavailable';
    const { container } = render(<NativeModelManagementSection />);
    expect(container.firstChild).toBeNull();
  });
});

describe('NativeModelManagementSection — embedded voice section on the selected MOSS card', () => {
  // moss-tts-nano is voice-cloning capable (clones: true) for en/zh/ja. Selecting it
  // (an explicit, 'ready' selections entry — selected state now flows through
  // resolve(), which only honors a ready candidate) makes it the resolved TTS
  // pick and ttsVoiceCapable true, so the voice picker is rendered as the
  // selected card's body — not as a separate block below.
  it('embeds the voice picker inside the selected MOSS card and nowhere else', async () => {
    const prevSelections = mockSettings.selections;
    mockSettings.selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'moss-tts-nano' } },
    };
    mockStatuses['moss-tts-nano'] = 'ready';
    try {
      render(<NativeModelManagementSection />);

      // Wait for the selected MOSS card; its body must contain the voice library UI.
      const mossCard = await waitFor(() => {
        const card = screen.getByTestId('model-card-moss-tts-nano');
        if (!card.querySelector('.voice-library-section')) throw new Error('voice section not yet rendered');
        return card;
      });
      const body = mossCard.querySelector('.model-card__body');
      expect(body).not.toBeNull();
      expect(within(body as HTMLElement).getByText('Voice')).toBeInTheDocument();

      // The TTS section must contain exactly one voice-library-section, and it must live
      // inside the MOSS card (no separate below-cards block remains).
      const ttsSection = document.getElementById('model-tts-section')!;
      expect(ttsSection.querySelectorAll('.voice-library-section')).toHaveLength(1);
    } finally {
      mockSettings.selections = prevSelections;
    }
  });
});

describe('NativeModelManagementSection — store-driven voice wiring (Task 13)', () => {
  // supertonic-3 declares voice: { builtin: 'named', custom: 'style' } — the
  // style-import backend (voiceStorage), distinct from MOSS's clip-clone
  // backend (nativeVoiceStorage). Selecting it must route NativeVoiceSection
  // to the style store and render its imported voices.
  it('renders imported style voices for a selected Supertonic-shaped model', async () => {
    const prevSelections = mockSettings.selections;
    mockSettings.selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'supertonic-3' } },
    };
    mockStatuses['supertonic-3'] = 'ready';
    try {
      render(<NativeModelManagementSection />);
      // 'MyVoice' appears both as a <select> option and in the "manage imported
      // voices" list (dropdown presentation) — either confirms the style store's
      // imported voice reached the UI.
      expect((await screen.findAllByText('MyVoice')).length).toBeGreaterThan(0);
    } finally {
      mockSettings.selections = prevSelections;
    }
  });
});

describe('NativeModelManagementSection — tier badge tooltip (Task 3)', () => {
  // sense-voice is a ja-compatible ASR card already exercised elsewhere in
  // this file (its "selected" state is irrelevant here — the tier badge and
  // its tooltip are driven by the catalog entry alone, not resolve()). Give
  // its available tier a known backend id so the tooltip's row builder
  // resolves a real framework/API label pair.
  it('tier badge tooltip lists the inference engine and device', async () => {
    mockCatalogOverride = {
      ...mockCatalog,
      'sense-voice': {
        ...mockCatalog['sense-voice'],
        tiers: [{ tier: 'gpu-vulkan', backend: 'llamacpp_gemma', available: true }],
      },
    };
    try {
      render(<NativeModelManagementSection />);
      const card = screen.getByTestId('model-card-sense-voice');

      // The Tooltip mock (above) renders `content` inline unconditionally, so no
      // hover/floating-ui simulation is needed in jsdom. Each tooltip row renders as
      // "<label>: <value>" where only the ": <value>" half is the row's own direct
      // text node (the label lives in a nested <span>) — match on that "colon +
      // value" substring so this doesn't also match the tier badge itself, which
      // separately renders "GPU · Vulkan" (a "·", not ":") from tierLabel().
      expect(await within(card).findByText(/: llama\.cpp/)).toBeInTheDocument();
      expect(within(card).getByText(/: Vulkan/)).toBeInTheDocument();
    } finally {
      mockCatalogOverride = null;
    }
  });
});

describe('NativeModelManagementSection — incompatible card click guard', () => {
  // Regression: an incompatible ASR card's click handler used to omit
  // `incompatible` from its guard, so clicking one under "Show all ASR
  // models" wrote it into selections despite the card being visibly
  // unselectable — an invisible no-op that only surfaces later, when
  // resolution rejects the language-incompatible explicit pick.
  it('clicking an incompatible ASR card (behind "Show all") does not write a selection', async () => {
    mockCatalogOverride = {
      ...mockCatalog,
      // languages: ['en'] does not include mockSettings.sourceLanguage ('ja'),
      // so this lands in asrIncompatibleCards, not the primary asrCards list.
      'whisper-en-only': {
        id: 'whisper-en-only', name: 'Whisper EN-only', languages: ['en'],
        recommended: false, tiers: [], order: 5, repo: 'whisper-en-only', kind: 'asr',
      },
    };
    // Downloaded (e.g. from a previous en→x session) so `ready` is already
    // true — isolating the assertion to the `incompatible` guard rather than
    // piggybacking on the (also correct) not-downloaded block.
    mockStatuses['whisper-en-only'] = 'ready';
    try {
      render(<NativeModelManagementSection />);
      fireEvent.click(screen.getByText(/Show all ASR models/));
      const card = screen.getByTestId('model-card-whisper-en-only');
      expect(card.className).toContain('model-card--incompatible');

      fireEvent.click(card);
      expect(mockUpdate).not.toHaveBeenCalled();
    } finally {
      mockCatalogOverride = null;
    }
  });
});
