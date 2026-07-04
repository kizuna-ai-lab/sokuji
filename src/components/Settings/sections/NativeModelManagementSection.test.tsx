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
  asrModel: 'sense-voice',
  translationModel: 'hy-mt2-7b',
  ttsModel: '',
  asrDevice: 'auto' as const,
  translationDevice: 'auto' as const,
  ttsDevice: 'auto' as const,
  translationVariantByModel: {},
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

// Tooltip uses FloatingPortal which causes jsdom issues; replace with a passthrough.
vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../stores/settingsStore', () => ({
  useLocalNativeSettings: () => mockSettings,
  useUpdateLocalNative: () => mockUpdate,
}));

vi.mock('../../../stores/nativeModelStore', () => {
  const mockStoreState = () => ({
    statuses: mockStatuses,
    sizes: mockSizes,
    progress: {},
    errors: {},
    catalog: mockCatalog,
    sidecarStatus: mockSidecarStatus,
    download: mockDownload,
    deleteModel: mockDeleteModel,
    cancelDownload: vi.fn(),
    refresh: mockRefresh,
    refreshCatalog: vi.fn().mockResolvedValue(undefined),
    setStatusRepos: mockSetStatusRepos,
    autoSelect: vi.fn().mockReturnValue(null),
    rememberModels: vi.fn(),
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
  it('header dropdown shows the chosen variant + size; opening it lists supported (enabled) and unsupported (disabled) variants', async () => {
    // All statuses absent (default) → pre-download state for hy-mt2-7b.
    render(<NativeModelManagementSection />);
    const q4SizeLabel = formatMemMb(Math.round(8e9 / 1e6));

    // The compact dropdown trigger appears in the header, showing the chosen variant + size.
    const trigger = await waitFor(() => {
      const card = screen.getByTestId('model-card-hy-mt2-7b');
      return within(card).getByTestId('variant-dd-hy-mt2-7b');
    });
    expect(trigger).toHaveTextContent('Q4_K_M');
    expect(trigger).toHaveTextContent(q4SizeLabel);

    // Variant rows are NOT rendered until the dropdown is opened (keeps the card short).
    expect(screen.queryByTestId('variant-row-q4_k_m')).not.toBeInTheDocument();

    // Open the menu.
    fireEvent.click(trigger);

    const card7b = screen.getByTestId('model-card-hy-mt2-7b');
    const q4Row = within(card7b).getByTestId('variant-row-q4_k_m');
    expect(q4Row).toHaveTextContent(q4SizeLabel);
    expect(within(q4Row).getByText('recommended')).toBeInTheDocument();
    expect(q4Row).toBeEnabled();

    // q8_0 is unsupported → listed (so the user sees the option) but not
    // selectable. It uses aria-disabled (not the disabled attribute) so the row
    // stays hoverable for the instant tooltip; a muted "blocked" icon marks it.
    const q8Row = within(card7b).getByTestId('variant-row-q8_0');
    expect(q8Row).toHaveAttribute('aria-disabled', 'true');
    expect(within(q8Row).getByLabelText("Won't fit on this machine")).toBeInTheDocument();
  });

  it('clicking a supported variant in the menu pins it (writes translationVariant)', async () => {
    render(<NativeModelManagementSection />);
    const trigger = await waitFor(() =>
      within(screen.getByTestId('model-card-hy-mt2-7b')).getByTestId('variant-dd-hy-mt2-7b'));
    fireEvent.click(trigger); // open the menu

    const q4Row = within(screen.getByTestId('model-card-hy-mt2-7b')).getByTestId('variant-row-q4_k_m');
    fireEvent.click(q4Row);

    // The pin reaches settings (single source of truth feeding both download repo and load).
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ translationVariantByModel: { 'hy-mt2-7b': 'q4_k_m' } }));
    // and it must NOT switch the active model
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ translationModel: expect.anything() }));
  });

  it('HY-MT1.5 cards also expose the quant-variant picker (the gate is data-driven variantIds, not a hy-mt2-only special case)', async () => {
    render(<NativeModelManagementSection />);
    // hy-mt15-7b is a multilingual card always present; its catalog entry carries
    // variantIds too, so it fetches variants and shows the same Q4_K_M dropdown as hy-mt2.
    const trigger = await waitFor(() =>
      within(screen.getByTestId('model-card-hy-mt15-7b')).getByTestId('variant-dd-hy-mt15-7b'));
    expect(trigger).toHaveTextContent('Q4_K_M');
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

describe('NativeModelManagementSection — TTS model card resolved badge', () => {
  // The default TTS voice for targetLanguage:'en' (mockSettings) is Amy
  // (csukuangfj/vits-piper-en_US-amy-low) — first catalog entry for 'en'.
  // With ttsModel:'' the component treats Amy as selected via pickNativeTts('en', catalog).
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

  it('shows an error + retry when the sidecar is unavailable', () => {
    mockSidecarStatus = 'unavailable';
    render(<NativeModelManagementSection />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRetrySidecar).toHaveBeenCalled();
  });
});

describe('NativeModelManagementSection — embedded voice section on the selected MOSS card', () => {
  // moss-tts-nano is voice-cloning capable (clones: true) for en/zh/ja. Selecting it
  // (ttsModel) makes ttsSelected('moss-tts-nano') true and ttsVoiceCapable true, so the
  // voice picker is rendered as the selected card's body — not as a separate block below.
  it('embeds the voice picker inside the selected MOSS card and nowhere else', async () => {
    const prevTtsModel = mockSettings.ttsModel;
    mockSettings.ttsModel = 'moss-tts-nano';
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
      mockSettings.ttsModel = prevTtsModel;
    }
  });
});

describe('NativeModelManagementSection — store-driven voice wiring (Task 13)', () => {
  // supertonic-3 declares voice: { builtin: 'named', custom: 'style' } — the
  // style-import backend (voiceStorage), distinct from MOSS's clip-clone
  // backend (nativeVoiceStorage). Selecting it must route NativeVoiceSection
  // to the style store and render its imported voices.
  it('renders imported style voices for a selected Supertonic-shaped model', async () => {
    const prevTtsModel = mockSettings.ttsModel;
    mockSettings.ttsModel = 'supertonic-3';
    try {
      render(<NativeModelManagementSection />);
      // 'MyVoice' appears both as a <select> option and in the "manage imported
      // voices" list (dropdown presentation) — either confirms the style store's
      // imported voice reached the UI.
      expect((await screen.findAllByText('MyVoice')).length).toBeGreaterThan(0);
    } finally {
      mockSettings.ttsModel = prevTtsModel;
    }
  });
});
