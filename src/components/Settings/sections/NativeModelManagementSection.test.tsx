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
import type { VariantInfo } from '../../../lib/local-inference/native/nativeProtocol';

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
};

const mockVariants: VariantInfo[] = [
  {
    id: 'fp8',
    computeType: 'fp8',
    repo: 'tencent/Hy-MT2-7B-FP8',
    sizeBytes: 8e9,
    supported: true,
    reason: 'fits in budget',
  },
  {
    id: 'bfloat16',
    computeType: 'bfloat16',
    repo: 'tencent/Hy-MT2-7B',
    sizeBytes: 15e9,
    supported: false,
    reason: 'exceeds budget',
  },
];

// Mutable store state — mutated per test in beforeEach
const mockStatuses: Record<string, string> = {};
const mockSizes: Record<string, number> = {};

const mockListVariants = vi.fn();
const mockDownload = vi.fn();
const mockUpdate = vi.fn();

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

vi.mock('../../../stores/nativeModelStore', () => ({
  useNativeModelStore: (sel: Function) =>
    sel({
      statuses: mockStatuses,
      sizes: mockSizes,
      progress: {},
      errors: {},
      catalog: {},
      download: mockDownload,
      deleteModel: vi.fn(),
      cancelDownload: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      refreshSizes: vi.fn().mockResolvedValue(undefined),
      refreshCatalog: vi.fn().mockResolvedValue(undefined),
      autoSelect: vi.fn().mockReturnValue(null),
      rememberModels: vi.fn(),
      asrLoading: false,
      asrResolved: null,
      translationResolved: null,
    }),
  useNativeModelStatuses: () => ({ ...mockStatuses }),
  useNativeModelProgress: () => ({}),
  useNativeModelSizes: () => ({ ...mockSizes }),
  useNativeModelErrors: () => ({}),
  useNativeCatalog: () => ({}),
  useNativeAsrLoading: () => false,
  useNativeAsrResolved: () => null,
  useNativeTranslationResolved: () => null,
  nativeListVariants: (...args: unknown[]) => mockListVariants(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset mutable state so tests are independent.
  Object.keys(mockStatuses).forEach((k) => delete mockStatuses[k]);
  Object.keys(mockSizes).forEach((k) => delete mockSizes[k]);
  mockListVariants.mockResolvedValue({ variants: mockVariants, recommended: 'fp8' });
  mockDownload.mockReset();
  mockUpdate.mockReset();
});

describe('NativeModelManagementSection — HY-MT2 variant card', () => {
  it('header dropdown shows the chosen variant + size; opening it lists supported (enabled) and unsupported (disabled) variants', async () => {
    // All statuses absent (default) → pre-download state for hy-mt2-7b.
    render(<NativeModelManagementSection />);
    const fp8SizeLabel = formatMemMb(Math.round(8e9 / 1e6));

    // The compact dropdown trigger appears in the header, showing the chosen variant + size.
    const trigger = await waitFor(() => {
      const card = screen.getByTestId('model-card-hy-mt2-7b');
      return within(card).getByTestId('variant-dd-hy-mt2-7b');
    });
    expect(trigger).toHaveTextContent('FP8');
    expect(trigger).toHaveTextContent(fp8SizeLabel);

    // Variant rows are NOT rendered until the dropdown is opened (keeps the card short).
    expect(screen.queryByTestId('variant-row-fp8')).not.toBeInTheDocument();

    // Open the menu.
    fireEvent.click(trigger);

    const card7b = screen.getByTestId('model-card-hy-mt2-7b');
    const fp8Row = within(card7b).getByTestId('variant-row-fp8');
    expect(fp8Row).toHaveTextContent(fp8SizeLabel);
    expect(within(fp8Row).getByText('recommended')).toBeInTheDocument();
    expect(fp8Row).toBeEnabled();

    // bfloat16 is unsupported → listed (so the user sees the option) but disabled.
    // A muted "blocked" icon marks it; the full reason lives in the title tooltip.
    const bf16Row = within(card7b).getByTestId('variant-row-bfloat16');
    expect(bf16Row).toBeDisabled();
    expect(within(bf16Row).getByLabelText("won't fit")).toBeInTheDocument();
    expect(bf16Row).toHaveAttribute('title', 'exceeds budget');
  });

  it('clicking a supported variant in the menu pins it (writes translationVariant)', async () => {
    render(<NativeModelManagementSection />);
    const trigger = await waitFor(() =>
      within(screen.getByTestId('model-card-hy-mt2-7b')).getByTestId('variant-dd-hy-mt2-7b'));
    fireEvent.click(trigger); // open the menu

    const fp8Row = within(screen.getByTestId('model-card-hy-mt2-7b')).getByTestId('variant-row-fp8');
    fireEvent.click(fp8Row);

    // The pin reaches settings (single source of truth feeding both download repo and load).
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ translationModel: 'hy-mt2-7b', translationVariant: 'fp8' }));
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

    expect(resolvedSpan).toHaveTextContent('FP8');
    expect(resolvedSpan).toHaveTextContent(downloadedSizeLabel);

    // No variant chooser buttons should appear on the hy-mt2-7b card after download.
    const card7b = screen.getByTestId('model-card-hy-mt2-7b');
    expect(within(card7b).queryByTestId('variant-row-fp8')).not.toBeInTheDocument();
    expect(within(card7b).queryByTestId('variant-row-bfloat16')).not.toBeInTheDocument();
  });

  it('downloads the chosen (recommended FP8) variant repo, not the default', async () => {
    // Pre-download state for hy-mt2-7b; FP8 is recommended.
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

    // Download must be called with the model's catalog id AND the FP8 variant's repo.
    expect(mockDownload).toHaveBeenCalledWith('hy-mt2-7b', 'tencent/Hy-MT2-7B-FP8');
  });
});
