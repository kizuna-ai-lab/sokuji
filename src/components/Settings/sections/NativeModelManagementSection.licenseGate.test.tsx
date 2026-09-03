/**
 * Focused test for Task 2 of the OmniVoice license-consent plan: the download
 * gate on a native model card whose catalog descriptor carries a license that
 * has to be acknowledged (NativeModelCardSpec.license.requiresConsent).
 *
 * Mirrors the mocking pattern in NativeModelManagementSection.test.tsx, trimmed
 * to a minimal catalog: one ASR card with a non-commercial license, one with a
 * restricted-but-commercially-usable license, and one plain card with none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { NativeModelManagementSection } from './NativeModelManagementSection';
import type { NativeModelInfo } from '../../../lib/local-inference/native/nativeProtocol';

const mockSettings = {
  sourceLanguage: 'en',
  targetLanguage: 'en',
  asrDevice: 'auto' as const,
  translationDevice: 'auto' as const,
  ttsDevice: 'auto' as const,
  selections: {
    'en→en': {
      asr: { modelId: 'lic-asr' }, translation: { modelId: '' }, tts: { modelId: '' },
    },
  },
};

// Minimal catalog: a non-commercial-licensed ASR card, a restricted-license one,
// and a plain (unlicensed) one.
// Translation/TTS groups are intentionally empty — RecommendedOthers renders
// nothing for an empty list and the TTS group falls back to its "no model"
// notice, so the section still renders without error.
const mockCatalog: Record<string, NativeModelInfo> = {
  'lic-asr': {
    id: 'lic-asr',
    name: 'Licensed ASR Model',
    languages: ['en'],
    recommended: true,
    tiers: [],
    order: 0,
    repo: 'org/lic-asr-repo',
    kind: 'asr',
    sizeBytes: 500000000,
    license: {
      spdx: 'CC-BY-NC-4.0',
      name: 'Creative Commons Attribution-NonCommercial 4.0',
      url: 'https://creativecommons.org/licenses/by-nc/4.0/',
      nonCommercial: true,
      requiresConsent: true,
      sourceRepo: 'org/lic-asr-repo',
      attribution: 'Some Org',
    },
  },
  // Restricted, but NOT non-commercial: the gate must still fire. Before
  // requiresConsent existed, gating on nonCommercial let a card like this
  // download with no acknowledgement at all.
  'restricted-asr': {
    id: 'restricted-asr',
    name: 'Restricted ASR Model',
    languages: ['en'],
    recommended: false,
    tiers: [],
    order: 2,
    repo: 'org/restricted-asr-repo',
    kind: 'asr',
    sizeBytes: 300000000,
    license: {
      spdx: 'LicenseRef-vendor-Model-Use-License',
      name: 'Vendor Model Use License',
      url: 'https://example.invalid/LICENSE',
      nonCommercial: false,
      requiresConsent: true,
      sourceRepo: 'org/restricted-asr-repo',
      attribution: 'Some Vendor',
    },
  },
  'plain-asr': {
    id: 'plain-asr',
    name: 'Plain ASR Model',
    languages: ['en'],
    recommended: false,
    tiers: [],
    order: 1,
    repo: 'org/plain-asr-repo',
    kind: 'asr',
    sizeBytes: 400000000,
  },
};

const mockStatuses: Record<string, string> = {};
const mockSizes: Record<string, number> = {};
const mockDownload = vi.fn();
const mockUpdate = vi.fn();
const mockRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string, vars?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars?.[name] ?? ''))
        : fallback ?? _k,
  }),
}));

// Tooltip uses FloatingPortal which causes jsdom issues; replace with a passthrough.
vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ children, content }: { children?: ReactNode; content?: ReactNode }) => (
    <>{children}{content}</>
  ),
}));

vi.mock('../../../stores/settingsStore', () => ({
  useLocalNativeSettings: () => mockSettings,
  useUpdateLocalNative: () => mockUpdate,
}));

vi.mock('../../../stores/nativeModelStore', () => {
  // Lightweight stand-in for the real selection resolver: an explicit,
  // catalog-known pick resolves; everything else (auto, or an id the mock
  // catalog doesn't carry) resolves to null. Good enough for these tests,
  // which only exercise the license-consent gate on the Download button, not
  // readiness/hardware gating.
  const mockResolve = (src: string, tgt: string, selections: any) => {
    const d = selections?.[`${src}→${tgt}`];
    const pick = (stage: 'asr' | 'translation' | 'tts') => {
      const sel = d?.[stage];
      return sel?.modelId && mockCatalog[sel.modelId]
        ? { modelId: sel.modelId, variant: sel.variant, source: 'explicit' as const }
        : null;
    };
    return { asr: pick('asr'), translation: pick('translation'), tts: pick('tts'), notes: [], prunes: [] };
  };
  const mockStoreState = () => ({
    statuses: mockStatuses,
    sizes: mockSizes,
    progress: {},
    errors: {},
    catalog: mockCatalog,
    resolve: mockResolve,
    sidecarStatus: 'ready',
    download: mockDownload,
    deleteModel: vi.fn(),
    cancelDownload: vi.fn(),
    refresh: mockRefresh,
    refreshCatalog: vi.fn().mockResolvedValue(undefined),
    setStatusRepos: vi.fn(),
    autoSelect: vi.fn().mockReturnValue(null),
    retrySidecar: vi.fn(),
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
    useNativeCatalog: () => mockCatalog,
    useNativeAsrLoading: () => false,
    useNativeAsrResolved: () => null,
    useNativeTranslationResolved: () => null,
    useNativeTtsResolved: () => null,
    useNativeSidecarStatus: () => 'ready',
    nativeListVariants: vi.fn(),
    nativeListTtsVoices: () => Promise.resolve([]),
  };
});

const acceptButtonQuery = () => screen.queryByRole('button', { name: /i understand/i });

beforeEach(() => {
  Object.keys(mockStatuses).forEach((k) => delete mockStatuses[k]);
  Object.keys(mockSizes).forEach((k) => delete mockSizes[k]);
  mockDownload.mockReset();
  mockUpdate.mockReset();
  mockRefresh.mockReset();
  mockRefresh.mockResolvedValue(undefined);
  // Fresh device: no license consent accepted yet for either test.
  window.localStorage.clear();
});

describe('NativeModelManagementSection — non-commercial license consent gate', () => {
  it('clicking Download on a non-commercial-licensed card opens the consent modal and does NOT download', () => {
    render(<NativeModelManagementSection />);
    const card = screen.getByTestId('model-card-lic-asr');

    fireEvent.click(within(card).getByRole('button', { name: /download/i }));

    expect(mockDownload).not.toHaveBeenCalled();
    expect(acceptButtonQuery()).toBeInTheDocument();
    // Content proves this is the license gate, not some other dialog.
    expect(screen.getByText(/org\/lic-asr-repo/)).toBeInTheDocument();
    expect(screen.getByText(/CC-BY-NC-4\.0/)).toBeInTheDocument();
  });

  it('accepting downloads exactly once and persists — a second Download click does not re-prompt', () => {
    render(<NativeModelManagementSection />);
    const card = screen.getByTestId('model-card-lic-asr');

    fireEvent.click(within(card).getByRole('button', { name: /download/i }));
    expect(acceptButtonQuery()).toBeInTheDocument();

    fireEvent.click(acceptButtonQuery()!);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledWith('lic-asr', undefined);
    expect(acceptButtonQuery()).not.toBeInTheDocument();

    // Second Download click: consent already recorded (persisted to localStorage)
    // — must download immediately, with no modal re-prompt.
    fireEvent.click(within(card).getByRole('button', { name: /download/i }));
    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(acceptButtonQuery()).not.toBeInTheDocument();
  });

  it('consent survives a remount (persisted to localStorage), so a fresh render does not re-prompt either', () => {
    const { unmount } = render(<NativeModelManagementSection />);
    let card = screen.getByTestId('model-card-lic-asr');
    fireEvent.click(within(card).getByRole('button', { name: /download/i }));
    fireEvent.click(acceptButtonQuery()!);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    unmount();

    render(<NativeModelManagementSection />);
    card = screen.getByTestId('model-card-lic-asr');
    fireEvent.click(within(card).getByRole('button', { name: /download/i }));
    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(acceptButtonQuery()).not.toBeInTheDocument();
  });

  it('Cancel closes the modal without downloading', () => {
    render(<NativeModelManagementSection />);
    const card = screen.getByTestId('model-card-lic-asr');

    fireEvent.click(within(card).getByRole('button', { name: /download/i }));
    expect(acceptButtonQuery()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(mockDownload).not.toHaveBeenCalled();
    expect(acceptButtonQuery()).not.toBeInTheDocument();
  });

  it('a restricted (but commercially usable) license still gates, without the non-commercial wording', () => {
    render(<NativeModelManagementSection />);
    const card = screen.getByTestId('model-card-restricted-asr');

    fireEvent.click(within(card).getByRole('button', { name: /download/i }));

    expect(mockDownload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /accept the license/i })).toBeInTheDocument();
    expect(screen.getByText(/Vendor Model Use License/)).toBeInTheDocument();
    expect(screen.queryByText(/non-commercial/i)).not.toBeInTheDocument();
  });

  it('a card with no license downloads immediately — the modal never shows', () => {
    render(<NativeModelManagementSection />);
    const card = screen.getByTestId('model-card-plain-asr');

    fireEvent.click(within(card).getByRole('button', { name: /download/i }));

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledWith('plain-asr', undefined);
    expect(acceptButtonQuery()).not.toBeInTheDocument();
  });
});
