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
import { asrRoles, catalogModelFor } from '../../../lib/local-inference/native/asrBenchmarks';
import { catalog as handyCatalog } from '@handy-computer/models';
import { NativeModelManagementSection } from './NativeModelManagementSection';
import { formatMemMb } from '../../../lib/local-inference/native/nativeCatalog';
import type { VariantInfo, NativeModelInfo } from '../../../lib/local-inference/native/nativeProtocol';

// Historically needed so a resolved language NAME (via languageNameFor) saw
// LOCAL_NATIVE registered in ProviderConfigFactory's static block (gated on
// isElectron() && isLocalNativeEnabled() — see localNativeGating.test.ts).
// languageNameFor no longer routes through ProviderConfigFactory (see its own
// doc comment in languageName.ts), so this is likely inert now, but left in
// place since nothing else in this file needs it disabled.
vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isElectron: () => true,
  isLocalNativeEnabled: () => true,
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
  ttsVoice: '',
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
        supported: true, recommended: true, downloaded: false },
      { id: 'q8_0', sizeBytes: 15e9, repo: 'tencent/Hy-MT2-7B-GGUF/HY-MT2-7B-Q8_0.gguf',
        supported: false, recommended: false, downloaded: false },
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
        supported: true, recommended: true, downloaded: false },
      { id: 'q8_0', sizeBytes: 15e9, repo: 'tencent/HY-MT1.5-7B-GGUF/HY-MT1.5-7B-Q8_0.gguf',
        supported: false, recommended: false, downloaded: false },
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
    // native_tts's supertonic card: named presets (sk_tts_presets), no
    // cloning and no custom-voice import (the old style-vector upload path
    // died with the ONNX Supertonic backend, Task 5/6).
    voice: { builtin: 'named', custom: 'none' },
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
    sizeBytes: 3600000000,
    variantIds: ['bf16', 'fp32', 'int8'],
    variants: [
      { id: 'bf16', sizeBytes: 3.6e9, repo: 'org/qwen3-tts-1.7b-bf16', supported: true, recommended: true, downloaded: false, unsupportedTiers: ['gpu-vulkan'] },
      { id: 'fp32', sizeBytes: 7.2e9, repo: 'org/qwen3-tts-1.7b-fp32', supported: true, recommended: false, downloaded: false },
      { id: 'int8', sizeBytes: 1.9e9, repo: 'org/qwen3-tts-1.7b-int8', supported: false, recommended: false, downloaded: false },
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
    downloaded: false,
  },
  {
    id: 'q8_0',
    computeType: 'q8_0',
    repo: 'tencent/Hy-MT2-7B-GGUF/HY-MT2-7B-Q8_0.gguf',
    sizeBytes: 15e9,
    supported: false,
    reason: 'exceeds budget',
    downloaded: false,
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
  // Interpolating — needed so the
  // availableWhenLang line's {{lang}} actually resolves to the language
  // NAME the component passed in, not the raw placeholder.
  useTranslation: () => ({
    t: (_k: string, fallback?: string, opts?: Record<string, any>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? ''))
        : _k,
  }),
}));

// Tooltip uses FloatingPortal which causes jsdom issues; replace with a passthrough
// that also surfaces `content` inline (unconditionally, unlike the real hover-gated
// tooltip) so tests can assert on tooltip content without simulating hover/floating-ui.
vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
    <>{children}{content}</>
  ),
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

// The import window: its own tests cover it; here only what the card hands it.
let mockErrors: Record<string, string> = {};
let mockErrorInfo: Record<string, { code: string; params: Record<string, string> }> = {};
const importModal = vi.hoisted(() => ({ props: [] as Array<{ isOpen: boolean; modelId: string; modelName: string; repo?: string }> }));
vi.mock('./NativeImportModal', () => ({
  NativeImportModal: (p: { isOpen: boolean; modelId: string; modelName: string; repo?: string }) => { importModal.props.push(p); return p.isOpen ? <div data-testid={`import-window-${p.modelId}`} /> : null; },
}));

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
    useNativeModelErrors: () => ({ ...mockErrors }),
    useNativeModelErrorInfo: () => ({ ...mockErrorInfo }),
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
  mockErrors = {};
  mockErrorInfo = {};
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
  it('shows the one quant a download fetches, with its size, and no picker', async () => {
    // All statuses absent (default) → pre-download state for hy-mt2-7b.
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    const q4SizeLabel = formatMemMb(Math.round(8e9 / 1e6));
    const label = await waitFor(() => within(screen.getByTestId('model-card-hy-mt2-7b')).getByTestId('variant-label-hy-mt2-7b'));
    expect(label).toHaveTextContent('Q4_K_M');
    expect(label).toHaveTextContent(q4SizeLabel);
    // One quant per model: no select, no rows to choose another.
    const card7b = screen.getByTestId('model-card-hy-mt2-7b');
    expect(within(card7b).queryByTestId('variant-dd-hy-mt2-7b')).toBeNull();
    expect(within(card7b).queryByTestId('variant-row-q8_0')).toBeNull();
  });

  it('HY-MT1.5 cards show their quant too (the gate is data-driven variantIds, not a hy-mt2-only special case)', async () => {
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    const label = await waitFor(() => within(screen.getByTestId('model-card-hy-mt15-7b')).getByTestId('variant-label-hy-mt15-7b'));
    expect(label).toHaveTextContent('Q4_K_M');
  });

  it('collapses to resolved variant label after download; no variant chooser buttons', async () => {
    // Mark hy-mt2-7b as downloaded with a known byte count.
    const downloadedBytes = 8_000_000_000;
    mockStatuses['hy-mt2-7b'] = 'ready';
    mockSizes['hy-mt2-7b'] = downloadedBytes;

    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);

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

    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
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

    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());

    expect(mockRefresh.mock.calls.every(([, repos]) => repos === undefined)).toBe(true);
    expect(mockSetStatusRepos).not.toHaveBeenCalled();
    mockCatalogOverride = null;
  });

  it('collects a variant pin from a direction OTHER than the one on screen (matches catalogStatusRepos\'s broader collection)', async () => {
    // Current direction is 'ja→en' (mockSettings.sourceLanguage/targetLanguage
    // at the top of this file); the pin lives on 'en→ja' instead. Before the
    // fix, the statusRepos memo only collected pins from the direction on
    // screen — this asserts the fix collects from every direction present in
    // `selections`.
    const prevSelections = mockSettings.selections;
    mockSettings.selections = {
      'en→ja': { asr: { modelId: '' }, translation: { modelId: 'hy-mt2-7b', variant: 'q8_0' }, tts: { modelId: '' } },
    };
    try {
      render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
      await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
      const repoOverrideCall = mockRefresh.mock.calls.find(([, repos]) => repos && 'hy-mt2-7b' in repos);
      expect(repoOverrideCall?.[1]).toMatchObject({
        'hy-mt2-7b': 'tencent/Hy-MT2-7B-GGUF/HY-MT2-7B-Q8_0.gguf',
      });
    } finally {
      mockSettings.selections = prevSelections;
    }
  });

  it('downloads the chosen (recommended Q4_K_M) variant repo, not the default', async () => {
    // Pre-download state for hy-mt2-7b; Q4_K_M is recommended.
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);

    // Wait for the variant data to land so the download button knows the chosen repo.
    const card7b = await waitFor(() => {
      const c = screen.getByTestId('model-card-hy-mt2-7b');
      within(c).getByTestId('variant-label-hy-mt2-7b'); // throws until variant data lands
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
  it('a multi-variant TTS card shows its one quant too (same as ASR/translation)', async () => {
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    const bf16SizeLabel = formatMemMb(Math.round(3.6e9 / 1e6));
    const label = await waitFor(() => within(screen.getByTestId('model-card-qwen3-tts-1.7b')).getByTestId('variant-label-qwen3-tts-1.7b'));
    expect(label).toHaveTextContent('BF16');
    expect(label).toHaveTextContent(bf16SizeLabel);
  });

  it('downloads the chosen (recommended BF16) variant repo for a TTS card, not the default', async () => {
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    const card = await waitFor(() => {
      const c = screen.getByTestId('model-card-qwen3-tts-1.7b');
      within(c).getByTestId('variant-label-qwen3-tts-1.7b'); // throws until variant data lands
      return c;
    });
    fireEvent.click(within(card).getByRole('button', { name: /Download/i }));
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

    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);

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

    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);

    // The whole TTS section must not contain any live badge.
    const ttsSection = document.getElementById('model-tts-section')!;
    expect(ttsSection).not.toBeNull();
    expect(ttsSection.querySelector('.model-card__lang-tag--live')).toBeNull();
  });
});

describe('NativeModelManagementSection — the host hands it the pair (#578)', () => {
  it("takes its pair from the host, not a settings store (#578)", () => {
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: 'zh', target: 'en' }} />);
    // The ASR group lists the cards for the host's source.
    expect(screen.getAllByText(/SenseVoice/i).length).toBeGreaterThan(0);
  });

  it("lists the ASR cards of the host's source, not the fixture's own pair (#578)", () => {
    // A zh-only model is a compatible card for a zh source only; for the
    // fixture's ja source it would sit behind "Show all".
    mockCatalogOverride = {
      ...mockCatalog,
      'zh-only-asr': {
        id: 'zh-only-asr', name: 'Mandarin ASR', languages: ['zh'],
        recommended: false, tiers: [], order: 6, repo: 'zh-only-asr', kind: 'asr',
      },
    };
    try {
      render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: 'zh', target: 'en' }} />);
      expect(screen.getByTestId('model-card-zh-only-asr').className).not.toContain('model-card--incompatible');
    } finally {
      mockCatalogOverride = null;
    }
  });

  it("writes a device pick through the host's update", () => {
    mockCatalogOverride = {
      ...mockCatalog,
      'gpu-asr': {
        id: 'gpu-asr', name: 'GPU ASR', languages: ['ja'], recommended: false, order: 7,
        repo: 'gpu-asr', kind: 'asr', tiers: [{ tier: 'gpu-vulkan', backend: 'native_asr', available: true }],
      },
    };
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: 'ja', target: 'en' }} />);
      fireEvent.click(screen.getByRole('button', { name: 'GPU' }));
      expect(mockUpdate).toHaveBeenCalledWith({ asrDevice: 'gpu' });
    } finally {
      mockCatalogOverride = null;
    }
  });
});

describe('NativeModelManagementSection — sidecar lifecycle states', () => {
  it('shows a starting placeholder while the sidecar warms', () => {
    mockSidecarStatus = 'starting';
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    expect(screen.getByText(/starting the local engine/i)).toBeInTheDocument();
  });

  it('renders nothing when the sidecar is unavailable (EngineSection owns the error)', () => {
    mockSidecarStatus = 'unavailable';
    const { container } = render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    expect(container.firstChild).toBeNull();
  });

  // Review on #888: a jump to a stage's native models made while the engine was starting found no anchor, and was lost.
  it("keeps a stage's anchor on the page while the engine starts or is unavailable", () => {
    for (const status of ['starting', 'idle', 'unavailable']) {
      mockSidecarStatus = status;
      const { unmount } = render(<NativeModelManagementSection stageFilter="asr" anchorId="native-models-asr-section" settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
      expect(document.getElementById('native-models-asr-section')).not.toBeNull();
      unmount();
    }
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
      render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);

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
        tiers: [{ tier: 'gpu-vulkan', backend: 'native_translate', available: true }],
      },
    };
    try {
      render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
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
      render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
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

// I3 (revised 2026-08-22): the user reviewed the Library push and decided it
// keeps the ORIGINAL model group list — Recommended/Others subgroups with
// full model cards and the "Show all N models" collapse for incompatible
// ones — not a compatible-first "Supports {{lang}}" / "Other languages"
// split. These cover the Library surface (stageFilter set, no other prop)
// rendering that same original structure. Native's translation/tts lists
// carry no incompatible bucket in the fixture catalog, so only ASR (which
// has a real incompatible list) exercises the show-all + availableWhenLang
// checks — the WASM file (ModelManagementSection.test.tsx) covers all three
// stages.
describe('NativeModelManagementSection — Library surface keeps the original model group list (I3, 2026-08-22)', () => {
  const asrIncompatibleFixture = {
    ...mockCatalog,
    // languages: ['en'] does not include mockSettings.sourceLanguage ('ja') —
    // same fixture as the click-guard test above, reused here.
    'whisper-en-only': {
      id: 'whisper-en-only', name: 'Whisper EN-only', languages: ['en'],
      recommended: false, tiers: [], order: 5, repo: 'whisper-en-only', kind: 'asr',
    } as NativeModelInfo,
  };

  it('lists the recommended models first, with no sub-heading over either part', async () => {
    render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    await screen.findByTestId('model-card-sense-voice');
    expect(document.querySelector('.model-subgroup__label')).toBeNull();
    const cards = [...document.querySelectorAll('[data-testid^="model-card-"]')];
    const recommended = cards.map((c) => c.querySelector('.model-card__recommended-badge') !== null);
    // Every recommended card comes before the first one that is not.
    expect(recommended.indexOf(false) === -1 || recommended.lastIndexOf(true) < recommended.indexOf(false)).toBe(true);
  });

  it('folds the models the stage does not show under "N more", and every ASR model renders somewhere (shown, or behind the fold)', async () => {
    mockCatalogOverride = asrIncompatibleFixture;
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
      const more = await screen.findByRole('button', { name: /\d+ more/ });
      fireEvent.click(more);
      expect(screen.getByText(/Models for other languages \(\d+\)/)).toBeInTheDocument();
      const allAsr = Object.values(asrIncompatibleFixture).filter((m) => m.kind === 'asr');
      for (const m of allAsr) {
        expect(screen.getByTestId(`model-card-${m.id}`)).toBeInTheDocument();
      }
    } finally {
      mockCatalogOverride = null;
    }
  });

  it('an incompatible model (behind the fold) offers Download but clicking it (the "Use" affordance) does not write a selection', async () => {
    mockCatalogOverride = asrIncompatibleFixture;
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
      fireEvent.click(await screen.findByRole('button', { name: /\d+ more/ }));

      const card = await screen.findByTestId('model-card-whisper-en-only');
      expect(within(card).getByRole('button', { name: /Download/i })).toBeEnabled();

      fireEvent.click(card);
      expect(mockUpdate).not.toHaveBeenCalled();
    } finally {
      mockCatalogOverride = null;
    }
  });

  it('a downloaded incompatible model (behind the fold) shows the "available when your language is" line, naming the language', async () => {
    mockCatalogOverride = asrIncompatibleFixture;
    mockStatuses['whisper-en-only'] = 'ready';
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
      fireEvent.click(await screen.findByRole('button', { name: /\d+ more/ }));
      await screen.findByTestId('model-card-whisper-en-only');

      const line = screen.getByText(/Available when your language is/);
      expect(line).toHaveTextContent('English');
    } finally {
      mockCatalogOverride = null;
    }
  });
});

// C1 folded finding: the Local models and storage page owns Clear-all now — the bottom
// ModelStorageFooter duplicate must not render on the Library push
// (stageFilter set), only on the standalone (prop-less) Settings-page render.
describe('NativeModelManagementSection — ModelStorageFooter only on the standalone render (C1)', () => {
  it('a Library-view (stageFilter set) render has no ModelStorageFooter', () => {
    render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    expect(document.querySelector('.model-management__storage')).not.toBeInTheDocument();
  });

  it('the standalone (prop-less stageFilter) render keeps the footer', () => {
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
    expect(document.querySelector('.model-management__storage')).toBeInTheDocument();
  });
});

describe('NativeModelManagementSection — the streaming tag', () => {
  it('marks a streaming model and no other', async () => {
    mockCatalogOverride = {
      ...mockCatalog,
      'stream-asr': { id: 'stream-asr', name: 'Stream ASR', languages: ['ja'], recommended: true, tiers: [], order: 9, repo: 'stream-asr', kind: 'asr', streaming: true } as NativeModelInfo,
    };
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
      await screen.findByTestId('model-card-stream-asr');
      expect(screen.getByTestId('streaming-stream-asr')).toHaveTextContent('Streaming');
      expect(screen.queryByTestId('streaming-sense-voice')).toBeNull();
    } finally {
      mockCatalogOverride = null;
    }
  });
});

// A recognition card says what the catalog Handy shows its list from says: a grade per language in play, a speed
// meter, Recommended or Faster for the pick and the quick one, and Streaming where the model streams (#578).
/** A catalog model that streams and speaks all the languages. */
const catalogStreamer = (langs: string[]): string => handyCatalog.models.find((m) => m.role === 'asr' && m.capabilities.streaming && langs.every((l) => m.languages.includes(l)))!.id;

describe('NativeModelManagementSection — recognition facts from the catalog', () => {
  const langs = ['en', 'de'];
  const pair = { source: 'en', target: 'de' };
  const asCard = (id: string, order: number): NativeModelInfo => ({
    id, name: id, languages: langs, recommended: false, tiers: [], order, repo: `handy-computer/${id}-gguf`, kind: 'asr', sizeBytes: 1,
  } as NativeModelInfo);

  it('badges the pick Recommended and the quick one Faster, grades both languages and draws the speed meter', async () => {
    const picks = asrRoles(langs);
    const best = [...picks].find(([, r]) => r === 'recommended')?.[0];
    const fast = [...picks].find(([, r]) => r === 'faster')?.[0];
    expect(best).toBeDefined();
    const ids = [best!, ...(fast ? [fast] : [])];
    mockCatalogOverride = Object.fromEntries(ids.map((id, i) => [id, asCard(id, i)]));
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={pair} />);
      const card = await screen.findByTestId(`model-card-${best}`);
      expect(within(card).getByText('Recommended')).toBeInTheDocument();
      expect(within(card).getByTestId(`grade-${best}-en`)).toHaveTextContent(/EN\s*[A-DF][+-]?/);
      expect(within(card).getByTestId(`grade-${best}-de`)).toHaveTextContent(/DE\s*[A-DF][+-]?/);
      expect(within(card).getByTestId(`speed-${best}`).querySelectorAll('i')).toHaveLength(5);
      // Its buttons sit in a column as wide as their widest state, held by a hidden copy of each state, so the facts
      // beside them line up from card to card (owner, 2026-11-27); the copy is out of reach of focus and of the tree.
      const sizer = within(card).getByTestId('actions-sizer');
      expect(sizer.closest('.model-card__actions')).toHaveClass('model-card__actions--aligned');
      expect(sizer).toHaveAttribute('aria-hidden', 'true');
      expect([...sizer.querySelectorAll('button')].every((b) => b.tabIndex === -1)).toBe(true);
      expect(sizer).toHaveTextContent(/Download.*Import.*Active.*Downloaded/);
      expect(within(card).getAllByRole('button', { name: /Download/ })).toHaveLength(1);
      if (fast) expect(within(screen.getByTestId(`model-card-${fast}`)).getByTestId(`faster-${fast}`)).toHaveTextContent('Faster');
    } finally {
      mockCatalogOverride = null;
    }
  });

  it('tags a streaming model Streaming, as the catalog says', async () => {
    const streamer = catalogStreamer(langs);
    mockCatalogOverride = { [streamer]: asCard(streamer, 0) };
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={pair} />);
      // Not the pick, so it sits behind "N more".
      const more = screen.queryByRole('button', { name: /\d+ more/ });
      if (more) fireEvent.click(more);
      await screen.findByTestId(`model-card-${streamer}`);
      expect(screen.getByTestId(`streaming-${streamer}`)).toHaveTextContent('Streaming');
    } finally {
      mockCatalogOverride = null;
    }
  });

  it('shows a dash where a language was not measured, and keeps our own Recommended where the catalog knows nothing of the cards', async () => {
    mockCatalogOverride = { 'sense-voice': { ...mockCatalog['sense-voice'] } };
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }} />);
      const card = await screen.findByTestId('model-card-sense-voice');
      expect(within(card).getByTestId('grade-sense-voice-ja')).toHaveTextContent('—');
      expect(within(card).getByText('Recommended')).toBeInTheDocument();
    } finally {
      mockCatalogOverride = null;
    }
  });
});

describe('NativeModelManagementSection — the Import button', () => {
  const pairProps = { settings: mockSettings, update: mockUpdate, pair: { source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage } };
  const lastFor = (id: string) => [...importModal.props].reverse().find((p) => p.modelId === id);

  it('sits beside Download on a model that is not downloaded, and opens the import window for that model', async () => {
    importModal.props.length = 0;
    render(<NativeModelManagementSection stageFilter="asr" {...pairProps} />);
    const card = await screen.findByTestId('model-card-sense-voice');
    expect(lastFor('sense-voice')?.isOpen).toBe(false);
    fireEvent.click(within(card).getByRole('button', { name: /^Import: SenseVoice$/ }));
    await waitFor(() => expect(lastFor('sense-voice')).toMatchObject({ isOpen: true, modelName: 'SenseVoice' }));
    // Outside the card, as the WASM/WebGPU engine's is: inside, it took the card's hand cursor and its clicks reached
    // the card (owner, 2026-11-27).
    const win = await screen.findByTestId(`import-window-${lastFor('sense-voice')!.modelId}`);
    expect(card.contains(win)).toBe(false);
  });

  it('hands the window the chosen variant\'s repo, so it names that variant\'s file', async () => {
    importModal.props.length = 0;
    render(<NativeModelManagementSection {...pairProps} />);
    const card = await waitFor(() => {
      const c = screen.getByTestId('model-card-hy-mt2-7b');
      within(c).getByTestId('variant-label-hy-mt2-7b');
      return c;
    });
    fireEvent.click(within(card).getByRole('button', { name: /^Import: / }));
    await waitFor(() => expect(lastFor('hy-mt2-7b')).toMatchObject({ isOpen: true, repo: 'tencent/Hy-MT2-7B-GGUF/Hy-MT2-7B-Q4_K_M.gguf' }));
  });

  it('is gone once the model is downloaded', async () => {
    mockStatuses['sense-voice'] = 'ready';
    render(<NativeModelManagementSection stageFilter="asr" {...pairProps} />);
    const card = await screen.findByTestId('model-card-sense-voice');
    expect(within(card).queryByRole('button', { name: /^Import: / })).toBeNull();
  });

  it('is not offered on a model for another language', async () => {
    mockCatalogOverride = {
      ...mockCatalog,
      'whisper-en-only': { id: 'whisper-en-only', name: 'Whisper EN-only', languages: ['en'], recommended: false, tiers: [], order: 5, repo: 'whisper-en-only', kind: 'asr' } as NativeModelInfo,
    };
    try {
      render(<NativeModelManagementSection stageFilter="asr" {...pairProps} />);
      fireEvent.click(await screen.findByRole('button', { name: /\d+ more/ }));
      const card = await screen.findByTestId('model-card-whisper-en-only');
      expect(within(card).queryByRole('button', { name: /^Import: / })).toBeNull();
    } finally {
      mockCatalogOverride = null;
    }
  });
});

describe('NativeModelManagementSection — a refused import', () => {
  const pairProps = { settings: mockSettings, update: mockUpdate, pair: { source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage } };

  it('says why in the interface\'s language, from the engine\'s code, under the row and not inside it', async () => {
    mockErrors = { 'sense-voice': 'missing: a.gguf' };
    mockErrorInfo = { 'sense-voice': { code: 'import_missing', params: { names: 'a.gguf' } } };
    render(<NativeModelManagementSection stageFilter="asr" {...pairProps} />);
    const card = await screen.findByTestId('model-card-sense-voice');
    const message = within(card).getByRole('alert');
    expect(message).toHaveTextContent('These files are missing: a.gguf. Download them and import again.');
    // Outside the row of info and buttons, so it cannot push them down.
    expect(message.closest('.model-card__content')).toBeNull();
    expect(card.className).toContain('model-card--error-below');
  });

  it('keeps the engine\'s own words for a failure it did not code', async () => {
    mockErrors = { 'sense-voice': 'disk full' };
    render(<NativeModelManagementSection stageFilter="asr" {...pairProps} />);
    expect(within(await screen.findByTestId('model-card-sense-voice')).getByRole('alert')).toHaveTextContent('disk full');
  });
});

describe('NativeModelManagementSection — a recognition model\'s one quant', () => {
  it('is the quant its published accuracy was measured on, not the engine\'s machine-aware pick, and that is what downloads', async () => {
    const info = catalogModelFor({ repo: 'handy-computer/cohere-transcribe-03-2026-gguf' })!;
    const measured = info.quant.toLowerCase();
    const other = measured === 'q4_k_m' ? 'q6_k' : 'q4_k_m';
    const variant = (id: string, recommended: boolean) => ({ id, repo: `handy-computer/cohere-transcribe-03-2026-gguf/cohere-${id}.gguf`, sizeBytes: 1e9, needBytes: 1e9, supported: true, recommended, downloaded: false });
    mockCatalogOverride = {
      'cohere-transcribe-03-2026': {
        id: 'cohere-transcribe-03-2026', name: 'Cohere Transcribe', languages: ['ja', 'en'], recommended: true, tiers: [], order: 0, kind: 'asr',
        repo: 'handy-computer/cohere-transcribe-03-2026-gguf', sizeBytes: 1e9,
        variants: [variant(other, true), variant(measured, false)],   // the engine recommends the OTHER quant here
      } as unknown as NativeModelInfo,
    };
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: 'ja', target: 'en' }} />);
      const card = await screen.findByTestId('model-card-cohere-transcribe-03-2026');
      expect(await within(card).findByTestId('variant-label-cohere-transcribe-03-2026')).toHaveTextContent(measured.toUpperCase());
      fireEvent.click(within(card).getByRole('button', { name: /Download/i }));
      expect(mockDownload).toHaveBeenCalledWith('cohere-transcribe-03-2026', `handy-computer/cohere-transcribe-03-2026-gguf/cohere-${measured}.gguf`);
    } finally {
      mockCatalogOverride = null;
    }
  });

  // Review on #888: another quant already on disk (from before the one quant was fixed) makes the card ready; the card
  // must name and delete that one, not the measured quant it would download.
  it('names and deletes the quant on disk when that is what makes the card ready', async () => {
    const info = catalogModelFor({ repo: 'handy-computer/cohere-transcribe-03-2026-gguf' })!;
    const measured = info.quant.toLowerCase();
    const other = measured === 'q4_k_m' ? 'q6_k' : 'q4_k_m';
    const variant = (id: string, downloaded: boolean) => ({ id, computeType: id, repo: `handy-computer/cohere-transcribe-03-2026-gguf/cohere-${id}.gguf`, sizeBytes: 1e9, needBytes: 1e9, supported: true, recommended: false, downloaded });
    mockCatalogOverride = {
      'cohere-transcribe-03-2026': {
        id: 'cohere-transcribe-03-2026', name: 'Cohere Transcribe', languages: ['ja', 'en'], recommended: true, tiers: [], order: 0, kind: 'asr',
        repo: 'handy-computer/cohere-transcribe-03-2026-gguf', sizeBytes: 1e9,
        variants: [variant(other, true), variant(measured, false)],
      } as unknown as NativeModelInfo,
    };
    mockStatuses['cohere-transcribe-03-2026'] = 'ready';
    mockSizes['cohere-transcribe-03-2026'] = 1e9;
    try {
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: 'ja', target: 'en' }} />);
      const card = await screen.findByTestId('model-card-cohere-transcribe-03-2026');
      expect(await within(card).findByTestId('variant-resolved-cohere-transcribe-03-2026')).toHaveTextContent(other.toUpperCase());
      fireEvent.click(within(card).getByRole('button', { name: /Delete/i }));
      expect(mockDeleteModel).toHaveBeenCalledWith('cohere-transcribe-03-2026', `handy-computer/cohere-transcribe-03-2026-gguf/cohere-${other}.gguf`);
    } finally {
      mockCatalogOverride = null;
      delete mockStatuses['cohere-transcribe-03-2026'];
      delete mockSizes['cohere-transcribe-03-2026'];
    }
  });

  // Review on #888: the quant picker said when a quant would run on the CPU here, or not fit at all; the one fixed quant
  // must still say so before it is downloaded.
  it("says when the one quant would run on the CPU here, or would not fit, before it is downloaded", async () => {
    const info = catalogModelFor({ repo: 'handy-computer/cohere-transcribe-03-2026-gguf' })!;
    const measured = info.quant.toLowerCase();
    const card = (extra: Record<string, unknown>) => ({
      'cohere-transcribe-03-2026': {
        id: 'cohere-transcribe-03-2026', name: 'Cohere Transcribe', languages: ['ja', 'en'], recommended: true, tiers: [], order: 0, kind: 'asr',
        repo: 'handy-computer/cohere-transcribe-03-2026-gguf', sizeBytes: 1e9,
        variants: [
          { id: measured, computeType: measured, repo: `handy-computer/cohere-transcribe-03-2026-gguf/cohere-${measured}.gguf`, sizeBytes: 1e9, needBytes: 1e9, supported: true, recommended: true, downloaded: false, ...extra },
          { id: 'q2_k', computeType: 'q2_k', repo: 'handy-computer/cohere-transcribe-03-2026-gguf/cohere-q2_k.gguf', sizeBytes: 5e8, needBytes: 5e8, supported: true, recommended: false, downloaded: false },
        ],
      } as unknown as NativeModelInfo,
    });
    try {
      mockCatalogOverride = card({ unsupportedTiers: ['gpu-vulkan'] });
      const { unmount } = render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: 'ja', target: 'en' }} />);
      let c = await screen.findByTestId('model-card-cohere-transcribe-03-2026');
      await within(c).findByTestId('variant-label-cohere-transcribe-03-2026');
      expect(within(c).getByTestId('variant-note-cohere-transcribe-03-2026')).toHaveTextContent('Runs on CPU on this machine');
      unmount();
      mockCatalogOverride = card({ supported: false });
      render(<NativeModelManagementSection stageFilter="asr" settings={mockSettings} update={mockUpdate} pair={{ source: 'ja', target: 'en' }} />);
      c = await screen.findByTestId('model-card-cohere-transcribe-03-2026');
      await within(c).findByTestId('variant-label-cohere-transcribe-03-2026');
      // Its own reason where the catalog gives one ("Needs ~954 MB of GPU memory"), else the general one.
      expect(within(c).getByTestId('variant-note-cohere-transcribe-03-2026')).toHaveTextContent(/Needs ~\d+ MB|Won't fit on this machine/);
    } finally {
      mockCatalogOverride = null;
    }
  });
});
