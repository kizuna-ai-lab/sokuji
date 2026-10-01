/**
 * SentenceSegmentationSection — the settings surface for the punctuation
 * stage after Amendment A2: one three-way mode (Off, By pause, By sentences)
 * stored once and clamped on read to what the current provider offers, the
 * size control under By sentences, the two pause sliders under By pause, and
 * — unchanged from A1 — one confirmation, one download, one delete for the
 * three-model pack.
 *
 * The offer this provider makes (`lib/view/appViewSettings`'s `offerFor` /
 * `selectedBoundaries`) is mocked wholesale, so each case below sets
 * `mockOffer` directly to the shape the case it stands in for used to
 * produce: Gemini (pause + sizes), Local Inference (Auto + sizes) and OpenAI
 * (Auto only). A fourth shape, sizes only with neither pause nor Auto, no
 * provider offers any more but the resolvers still have a rule for it, so it
 * stays under test as a bare offer.
 *
 * `segmentationStore` is the REAL store, with its four actions swapped for
 * spies through `setState` — the store keeps its real `PACK_MODELS` and
 * `PACK_TOTAL_BYTES` (so every size asserted below comes from the manifest,
 * not a literal) while nothing reaches IndexedDB. `settingsStore` is mocked
 * with just the hooks this component calls (house pattern, see
 * HelpSection.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, d?: string, vars?: Record<string, unknown>) =>
        typeof d === 'string'
          ? d.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars?.[name] ?? ''))
          : _k,
    }),
  };
});

interface MockOffer {
  pause: boolean;
  auto: boolean;
  sizes: boolean;
}

let mockMode = 'off';
const setSegmentationMode = vi.fn();
let mockChunkSentences = 3;
const setChunkSentences = vi.fn();
let mockSourcePause = 1.5;
const setSourcePause = vi.fn();
let mockTranslationPause = 1.5;
const setTranslationPause = vi.fn();

/** Stands in for the selected provider's `boundaries(s)` and what it offers
 *  the stored cut — set per case the way `mockProvider` used to be, since
 *  `offerFor`/`selectedBoundaries` are mocked wholesale below rather than
 *  resolved from a real provider. */
let mockBoundaries: 'provider' | 'silence' = 'silence';
let mockOffer: MockOffer = { pause: true, auto: false, sizes: true };

vi.mock('../../../stores/settingsStore', () => ({
  useSegmentationMode: () => mockMode,
  useSetSegmentationMode: () => setSegmentationMode,
  useSentenceSegmentationChunkSentences: () => mockChunkSentences,
  useSetSentenceSegmentationChunkSentences: () => setChunkSentences,
  useSegmentationSourcePause: () => mockSourcePause,
  useSetSegmentationSourcePause: () => setSourcePause,
  useSegmentationTranslationPause: () => mockTranslationPause,
  useSetSegmentationTranslationPause: () => setTranslationPause,
}));

vi.mock('../../../lib/view/appViewSettings', () => ({
  selectedBoundaries: () => mockBoundaries,
  offerFor: () => mockOffer,
}));

// The re-render selector only; its shape is irrelevant here since the offer
// itself comes straight from the mock above.
vi.mock('../../../stores/providerStore', () => ({
  useProviderStore: () => undefined,
}));

// The real store never reaches the disk here: its four actions are replaced
// with spies below, and this keeps the module graph honest anyway.
vi.mock('../../../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: vi.fn() },
}));

// House pattern (HelpSection.test.tsx): the real module re-exports through
// shared/index.tsx, whose module body mounts a React root.
const trackEvent = vi.fn();
vi.mock('../../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));

const reportWarningMock = vi.fn();
vi.mock('../../../lib/diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/diagnostics/report')>();
  return { ...actual, reportWarning: (...args: unknown[]) => reportWarningMock(...args) };
});

const { default: SentenceSegmentationSection } = await import('./SentenceSegmentationSection');
const { default: useLogStore } = await import('../../../stores/logStore');
const { useSegmentationStore, PACK_MODELS, PACK_TOTAL_BYTES } =
  await import('../../../stores/segmentationStore');
const { formatBytes } = await import('../../../lib/local-inference/formatBytes');
const { MIN_SEGMENT_PAUSE_SECONDS, MAX_SEGMENT_PAUSE_SECONDS } =
  await import('../../../lib/segmentation/segmentationMode');

const refresh = vi.fn();
const download = vi.fn();
const cancel = vi.fn();
const deleteModels = vi.fn();

/** navigator.deviceMemory is undefined in jsdom, which `isLowMemoryDevice`
 *  reads as exactly the 4GB threshold — i.e. low-memory. Every test but the
 *  low-memory one needs a value above it, or By sentences renders disabled
 *  everywhere. */
function setDeviceMemory(gb: number | undefined): void {
  if (gb === undefined) {
    delete (navigator as { deviceMemory?: number }).deviceMemory;
  } else {
    Object.defineProperty(navigator, 'deviceMemory', { value: gb, configurable: true });
  }
}

const renderSection = (isSessionActive = false) =>
  render(<SentenceSegmentationSection isSessionActive={isSessionActive} />);

const modeButton = (label: string) =>
  screen.getAllByText(label).find((el) => el.tagName === 'BUTTON') as HTMLButtonElement;

const queryModeButton = (label: string) =>
  screen.queryAllByText(label).find((el) => el.tagName === 'BUTTON');

const sizeButton = (label: string) =>
  screen.getAllByText(label).find((el) => el.tagName === 'BUTTON') as HTMLButtonElement;

const confirmation = () => screen.queryByRole('dialog');

beforeEach(() => {
  cleanup();
  setDeviceMemory(8);
  mockBoundaries = 'silence';
  mockOffer = { pause: true, auto: false, sizes: true };
  mockMode = 'off';
  mockChunkSentences = 3;
  mockSourcePause = 1.5;
  mockTranslationPause = 1.5;
  setSegmentationMode.mockClear();
  setChunkSentences.mockClear();
  setSourcePause.mockClear();
  setTranslationPause.mockClear();
  refresh.mockReset().mockResolvedValue(undefined);
  // The real `download()` records the mode it was started from and drops it
  // when the download settles; the Cancel path reads that field back, so the
  // spy keeps that half of the contract.
  download.mockReset().mockImplementation(async (modeBefore?: string) => {
    useSegmentationStore.setState({ modeBeforeDownload: (modeBefore ?? null) as never });
  });
  cancel.mockReset();
  deleteModels.mockReset().mockResolvedValue(undefined);
  reportWarningMock.mockClear();
  trackEvent.mockClear();
  useSegmentationStore.setState({
    phase: 'unknown',
    downloadedBytes: 0,
    error: null,
    modeBeforeDownload: null,
    refresh,
    download,
    cancel,
    deleteModels,
  });
  localStorage.removeItem('debug:device-memory');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SentenceSegmentationSection', () => {
  it('renders the section with id="sentence-segmentation-section"', () => {
    renderSection();
    expect(document.querySelector('#sentence-segmentation-section')).not.toBeNull();
  });

  it('asks the disk once on mount, so a Clear all elsewhere is noticed', () => {
    renderSection();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  describe('the mode control', () => {
    it('offers all three modes on a provider that cuts on its own timers', () => {
      mockOffer = { pause: true, auto: false, sizes: true };
      renderSection();

      expect(modeButton('Off')).toBeTruthy();
      expect(modeButton('By pause')).toBeTruthy();
      expect(modeButton('By sentences')).toBeTruthy();
    });

    it('drops By pause on a provider whose boundaries a server decides', () => {
      mockOffer = { pause: false, auto: true, sizes: false };
      renderSection();

      expect(modeButton('Off')).toBeTruthy();
      expect(queryModeButton('By pause')).toBeUndefined();
      expect(modeButton('By sentences')).toBeTruthy();
    });

    it('drops By pause on the local engines too', () => {
      mockOffer = { pause: false, auto: true, sizes: true };
      renderSection();

      expect(queryModeButton('By pause')).toBeUndefined();
    });

    it('shows the resolved mode as selected, not the stored one', () => {
      // 'pause' is the stored default; on a provider without timers it
      // resolves to Off, and Off is what has to look chosen.
      mockMode = 'pause';
      mockOffer = { pause: false, auto: true, sizes: false };
      renderSection();

      expect(modeButton('Off').className).toContain('active');
    });

    it('stores the mode the user picked', () => {
      mockOffer = { pause: true, auto: false, sizes: true };
      renderSection();

      fireEvent.click(modeButton('By pause'));
      expect(setSegmentationMode).toHaveBeenCalledWith('pause');
    });

    it('lets Off be stored where the stored mode only reads as Off', () => {
      // `pause` is the stored default and resolves to Off on a provider with
      // no timers, so Off already looks selected. Clicking it has to write
      // `off` all the same: otherwise the user cannot make Off the stored
      // value from here, and switching to Gemini brings By pause back.
      mockOffer = { pause: false, auto: true, sizes: false };
      mockMode = 'pause';
      renderSection();

      expect(modeButton('Off').className).toContain('active');
      fireEvent.click(modeButton('Off'));
      expect(setSegmentationMode).toHaveBeenCalledWith('off');
    });

    it('still does nothing when the clicked mode is the stored one', () => {
      mockOffer = { pause: true, auto: false, sizes: true };
      mockMode = 'pause';
      renderSection();

      fireEvent.click(modeButton('By pause'));
      expect(setSegmentationMode).not.toHaveBeenCalled();
    });

    it('turning the mode off cancels a download in flight', () => {
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1024 });
      renderSection();

      fireEvent.click(modeButton('Off'));

      expect(setSegmentationMode).toHaveBeenCalledWith('off');
      expect(cancel).toHaveBeenCalledTimes(1);
      // cancel() leaves downloadedBytes counting bytes that were fetched but not
      // necessarily stored as whole models, so the disk has to be re-asked or the
      // delete link would offer a size that isn't there.
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('keeps the modes editable during a session', () => {
      renderSection(true);
      for (const label of ['Off', 'By pause', 'By sentences']) {
        expect(modeButton(label).disabled).toBe(false);
      }
    });
  });

  describe('choosing By sentences', () => {
    it('opens the confirmation and leaves the mode alone until it is confirmed', () => {
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();
      expect(confirmation()).toBeNull();

      fireEvent.click(modeButton('By sentences'));

      expect(confirmation()).not.toBeNull();
      expect(screen.getByText('Download segmentation models')).toBeTruthy();
      expect(setSegmentationMode).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
    });

    it('confirming sets the mode and starts the download', () => {
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();
      fireEvent.click(modeButton('By sentences'));

      fireEvent.click(screen.getByText(`Download ${formatBytes(PACK_TOTAL_BYTES)}`));

      expect(setSegmentationMode).toHaveBeenCalledWith('sentences');
      expect(download).toHaveBeenCalledTimes(1);
      expect(confirmation()).toBeNull();
    });

    it('cancelling the confirmation leaves the previous mode intact', () => {
      mockMode = 'pause';
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();
      fireEvent.click(modeButton('By sentences'));

      fireEvent.click(screen.getByText('Cancel'));

      expect(confirmation()).toBeNull();
      expect(setSegmentationMode).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
      expect(modeButton('By pause').className).toContain('active');
    });

    it('cancelling the download puts the mode back where it was, not on Off', () => {
      // By pause is a different way of cutting bubbles on the three providers
      // that offer it, so a user who changed their mind about the 402 MB must
      // not quietly lose it.
      mockMode = 'pause';
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();
      fireEvent.click(modeButton('By sentences'));
      fireEvent.click(screen.getByRole('button', { name: /^Download / }));
      expect(setSegmentationMode).toHaveBeenLastCalledWith('sentences');

      // The same mounted section, the way it is in the app: the mode it reads
      // is now By sentences and the store is mid-download.
      mockMode = 'sentences';
      act(() => {
        useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1000 });
      });
      fireEvent.click(screen.getByTestId('segmentation-download-cancel'));

      expect(cancel).toHaveBeenCalled();
      expect(setSegmentationMode).toHaveBeenLastCalledWith('pause');
    });

    it('cancelling a retry leaves the mode where it already was', () => {
      // Retry is only reachable from By sentences and says nothing about an
      // earlier mode. Dropping the user to Off there would change how bubbles
      // cut on the three pause providers, over a download they merely stopped
      // retrying.
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'error', error: 'network', modeBeforeDownload: null });
      renderSection();
      fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
      act(() => {
        useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1000 });
      });
      fireEvent.click(screen.getByTestId('segmentation-download-cancel'));

      expect(cancel).toHaveBeenCalled();
      expect(setSegmentationMode).not.toHaveBeenCalled();
    });

    it('still puts the mode back after the section has been unmounted and remounted', () => {
      // Switching Advanced settings to another tab and back unmounts this
      // section — `AdvancedSettings` keys `.settings-content` on the active
      // tab — while the download carries on in the store. Anything the
      // component remembered about the pre-download mode is gone by the time
      // Cancel is clicked, so the download has to be the one remembering.
      mockMode = 'pause';
      useSegmentationStore.setState({ phase: 'missing' });
      const first = renderSection();
      fireEvent.click(modeButton('By sentences'));
      fireEvent.click(screen.getByRole('button', { name: /^Download / }));
      expect(setSegmentationMode).toHaveBeenLastCalledWith('sentences');

      mockMode = 'sentences';
      act(() => {
        useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1000 });
      });

      // Away to another tab, and back.
      first.unmount();
      renderSection();

      fireEvent.click(screen.getByTestId('segmentation-download-cancel'));

      expect(cancel).toHaveBeenCalled();
      expect(setSegmentationMode).toHaveBeenLastCalledWith('pause');
    });

    it('sets the mode without asking when the models are already there', () => {
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();

      fireEvent.click(modeButton('By sentences'));

      expect(setSegmentationMode).toHaveBeenCalledWith('sentences');
      expect(confirmation()).toBeNull();
      expect(download).not.toHaveBeenCalled();
    });
  });

  describe('the size control', () => {
    it('shows 1-5 and no Auto where only sizes are offered', () => {
      // No provider offers this shape any more — the local engines held it
      // until phase 2 gave them Auto — but the resolvers still have a rule
      // for it, so the rendering rule is kept under test directly.
      mockOffer = { pause: false, auto: false, sizes: true };
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();

      for (let n = 1; n <= 5; n++) expect(sizeButton(String(n))).toBeTruthy();
      expect(screen.queryByText('Auto')).toBeNull();
    });

    it('shows Auto on its own where it is the only thing offered', () => {
      // A By sentences mode with nothing under it reads as broken, and on this
      // provider the single button is the only place the word Auto appears.
      mockOffer = { pause: false, auto: true, sizes: false };
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();

      expect(screen.getByText('Sentences per bubble')).toBeTruthy();
      expect(screen.getByText('Auto')).toBeTruthy();
      expect(screen.queryByText('1')).toBeNull();
    });

    it('shows Auto alongside 1-5 where both are offered', () => {
      // Local Inference's offer: its segment can be kept whole by Auto, or
      // cut inside every N sentences.
      mockOffer = { pause: false, auto: true, sizes: true };
      mockMode = 'sentences';
      mockChunkSentences = 0;
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();

      expect(sizeButton('Auto').className).toContain('active');
      for (let n = 1; n <= 5; n++) expect(sizeButton(String(n))).toBeTruthy();
      fireEvent.click(sizeButton('2'));
      expect(setChunkSentences).toHaveBeenCalledWith(2);
    });

    it('is absent unless the mode is By sentences', () => {
      mockOffer = { pause: true, auto: false, sizes: true };
      mockMode = 'pause';
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();
      expect(screen.queryByText('Sentences per bubble')).toBeNull();

      cleanup();
      mockMode = 'off';
      renderSection();
      expect(screen.queryByText('Sentences per bubble')).toBeNull();
    });

    it('stays disabled until the models are ready', () => {
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();
      for (let n = 1; n <= 5; n++) expect(sizeButton(String(n)).disabled).toBe(true);

      cleanup();
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();
      for (let n = 1; n <= 5; n++) expect(sizeButton(String(n)).disabled).toBe(false);
      fireEvent.click(sizeButton('5'));
      expect(setChunkSentences).toHaveBeenCalledWith(5);
    });
  });

  describe('the pause sliders', () => {
    it('appear only in By pause, and carry the global seconds', () => {
      mockOffer = { pause: true, auto: false, sizes: true };
      mockMode = 'pause';
      mockSourcePause = 0.8;
      mockTranslationPause = 2.2;
      renderSection();

      const source = screen.getByTestId('segmentation-source-pause') as HTMLInputElement;
      const translation = screen.getByTestId('segmentation-translation-pause') as HTMLInputElement;
      expect(source.value).toBe('0.8');
      expect(translation.value).toBe('2.2');
      expect(screen.getByText('0.80s')).toBeTruthy();
      expect(screen.getByText('2.20s')).toBeTruthy();

      fireEvent.change(source, { target: { value: '1.2' } });
      expect(setSourcePause).toHaveBeenCalledWith(1.2);
      fireEvent.change(translation, { target: { value: '0.5' } });
      expect(setTranslationPause).toHaveBeenCalledWith(0.5);
    });

    it('are gone in Off and in By sentences', () => {
      mockOffer = { pause: true, auto: false, sizes: true };
      mockMode = 'off';
      renderSection();
      expect(screen.queryByTestId('segmentation-source-pause')).toBeNull();

      cleanup();
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();
      expect(screen.queryByTestId('segmentation-source-pause')).toBeNull();
    });

    it('are gone on a provider whose stored pause mode resolves to Off', () => {
      mockOffer = { pause: false, auto: true, sizes: false };
      mockMode = 'pause';
      renderSection();
      expect(screen.queryByTestId('segmentation-source-pause')).toBeNull();
    });

    it('carry the shared range, not a second copy of it', () => {
      mockOffer = { pause: true, auto: false, sizes: true };
      mockMode = 'pause';
      renderSection();

      for (const id of ['segmentation-source-pause', 'segmentation-translation-pause']) {
        const slider = screen.getByTestId(id) as HTMLInputElement;
        expect(slider.min, `${id} min`).toBe(String(MIN_SEGMENT_PAUSE_SECONDS));
        expect(slider.max, `${id} max`).toBe(String(MAX_SEGMENT_PAUSE_SECONDS));
      }
    });

    it('keep the pauses editable during a session', () => {
      mockMode = 'pause';
      renderSection(true);
      expect((screen.getByTestId('segmentation-source-pause') as HTMLInputElement).disabled).toBe(false);
      expect((screen.getByTestId('segmentation-translation-pause') as HTMLInputElement).disabled).toBe(false);
    });
  });

  describe('download telemetry', () => {
    /** The store's `download()` never rejects: it writes the phase and
     *  resolves, which is why the outcome is read off the phase. */
    const settleDownloadInto = async (phase: 'ready' | 'error' | 'missing') => {
      download.mockImplementation(async () => { useSegmentationStore.setState({ phase }); });
      fireEvent.click(screen.getByText(`Download ${formatBytes(PACK_TOTAL_BYTES)}`));
      await vi.waitFor(() => expect(trackEvent).toHaveBeenCalled());
    };

    const startFromConfirmation = () => {
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();
      fireEvent.click(modeButton('By sentences'));
    };

    it('reports the confirmed download, its size and how long it took', async () => {
      startFromConfirmation();
      await settleDownloadInto('ready');

      expect(trackEvent).toHaveBeenCalledWith('segmentation_models_download', expect.objectContaining({
        // The same 1024 base as the size the confirmation dialog showed.
        size_mb: Math.round(PACK_TOTAL_BYTES / (1024 * 1024)),
        result: 'ok',
      }));
      expect(typeof trackEvent.mock.calls[0][1].duration_ms).toBe('number');
    });

    it('reports a failed download as error', async () => {
      startFromConfirmation();
      await settleDownloadInto('error');
      expect(trackEvent.mock.calls[0][1].result).toBe('error');
    });

    it('reports a download the user cancelled as cancelled, not as a failure', async () => {
      // Cancel leaves 'missing' behind — the one outcome that is neither the
      // pack being there nor anything having gone wrong.
      startFromConfirmation();
      await settleDownloadInto('missing');
      expect(trackEvent.mock.calls[0][1].result).toBe('cancelled');
    });

    // The spec asks for download durations in LogsPanel, not only in a console
    // the user cannot copy out of a packaged build.
    it('puts the finished download on the exportable diagnostic log', async () => {
      useLogStore.getState().setEnabled(true);
      useLogStore.getState().clearLogs();
      startFromConfirmation();
      await settleDownloadInto('ready');

      const events = useLogStore.getState().allLogs
        .flatMap((l) => l.events ?? [])
        .filter((e) => e.type === 'segmentation.pack.downloaded');
      expect(events).toHaveLength(1);
      expect(events[0].data).toMatchObject({ result: 'ok' });
      expect(typeof events[0].data.duration_ms).toBe('number');
    });

    it('writes nothing to the log when diagnostic logs are off', async () => {
      useLogStore.getState().setEnabled(false);
      startFromConfirmation();
      await settleDownloadInto('ready');

      expect(useLogStore.getState().allLogs).toEqual([]);
    });

    it('reports the status line Retry the same way as the confirmation', async () => {
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'error', error: 'network down' });
      renderSection();

      download.mockImplementation(async () => { useSegmentationStore.setState({ phase: 'ready' }); });
      fireEvent.click(screen.getByText('Retry'));
      await vi.waitFor(() => expect(trackEvent).toHaveBeenCalled());
      expect(trackEvent.mock.calls[0][1].result).toBe('ok');
    });
  });

  describe('the pack status line', () => {
    it('shows progress and a cancel action while downloading', () => {
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 100 * 1024 * 1024 });
      renderSection();

      expect(screen.getByText(`Downloading 100.0 MB of ${formatBytes(PACK_TOTAL_BYTES)}`)).toBeTruthy();
      const fill = screen.getByTestId('segmentation-progress-fill');
      expect(fill.style.width).toBe(`${(100 * 1024 * 1024 / PACK_TOTAL_BYTES) * 100}%`);
      expect(screen.getByTestId('segmentation-download-cancel')).toBeTruthy();
    });

    it('cancelling a download that recorded no origin leaves the mode alone', () => {
      // A download with no `modeBeforeDownload` was started from inside By
      // sentences — the status line's Retry or Download. The models are
      // missing either way and the section says so; moving the user to Off
      // would change how bubbles cut on the three pause providers.
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1024, modeBeforeDownload: null });
      renderSection();

      fireEvent.click(screen.getByTestId('segmentation-download-cancel'));

      expect(setSegmentationMode).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('shows the error and a retry action after a failed download', () => {
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'error', error: 'network down' });
      renderSection();

      expect(screen.getByText('Download failed: network down')).toBeTruthy();
      fireEvent.click(screen.getByText('Retry'));
      expect(download).toHaveBeenCalledTimes(1);
      // A retry resumes over what is already there; it never re-asks.
      expect(confirmation()).toBeNull();
    });

    it('offers Download again when the mode is By sentences but the files are missing', () => {
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();

      expect(screen.getByText('The models are not on this device.')).toBeTruthy();
      fireEvent.click(screen.getByText('Download'));
      expect(confirmation()).not.toBeNull();
    });

    it('says nothing while the phase is still unknown', () => {
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'unknown' });
      renderSection();

      expect(screen.queryByText('The models are not on this device.')).toBeNull();
      expect(screen.queryByTestId('segmentation-progress-fill')).toBeNull();
      expect(screen.queryByText('Retry')).toBeNull();
    });

    it('says nothing once the pack is ready', () => {
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();

      expect(screen.queryByText('The models are not on this device.')).toBeNull();
      expect(screen.queryByTestId('segmentation-progress-fill')).toBeNull();
    });

    it('a settings write that rolls back mid-download keeps Cancel and withholds the delete link', () => {
      // `setSegmentationMode` writes the value, then rolls it back when
      // `persistSetting` returns false — while the download it started keeps
      // running. Gating the status line on the mode alone would take Cancel
      // away with it and put the delete link up over a live fetch.
      useSegmentationStore.setState({ phase: 'missing' });
      const { rerender } = renderSection();
      fireEvent.click(modeButton('By sentences'));
      fireEvent.click(screen.getByText(`Download ${formatBytes(PACK_TOTAL_BYTES)}`));
      expect(download).toHaveBeenCalledTimes(1);

      useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1024 });
      mockMode = 'off'; // the persist failed and rolled it back
      rerender(<SentenceSegmentationSection isSessionActive={false} />);

      expect(screen.getByTestId('segmentation-download-cancel')).toBeTruthy();
      expect(screen.queryByText(/Delete models/)).toBeNull();

      // ...and it still cancels. The mode already reads Off, so a Cancel that
      // went through the mode control's "already there" guard would leave the
      // fetch running with nothing left to stop it.
      fireEvent.click(screen.getByTestId('segmentation-download-cancel'));
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(setSegmentationMode).toHaveBeenCalledTimes(1); // the confirmation's, not a second one
    });
  });

  it('offers a delete link, with the size, in By sentences and nowhere else', () => {
    // The pack belongs to that mode, so that is where its 402 MB is accounted
    // for; Off and By pause have nothing to do with the models.
    mockMode = 'sentences';
    const partial = PACK_MODELS[1].sizeBytes;
    useSegmentationStore.setState({ phase: 'missing', downloadedBytes: partial });
    renderSection();
    const link = screen.getByText(`Delete models (${formatBytes(partial)})`);
    fireEvent.click(link);
    expect(deleteModels).toHaveBeenCalledTimes(1);

    // Nothing on disk: nothing to delete.
    cleanup();
    useSegmentationStore.setState({ downloadedBytes: 0 });
    renderSection();
    expect(screen.queryByText(/Delete models/)).toBeNull();

    // Off, with the pack on disk: not offered.
    cleanup();
    mockMode = 'off';
    useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
    renderSection();
    expect(screen.queryByText(/Delete models/)).toBeNull();

    // By pause likewise.
    cleanup();
    mockMode = 'pause';
    renderSection();
    expect(screen.queryByText(/Delete models/)).toBeNull();

    // Never mid-download, which would delete files out from under the fetch.
    cleanup();
    mockMode = 'sentences';
    useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: PACK_TOTAL_BYTES });
    renderSection();
    expect(screen.queryByText(/Delete models/)).toBeNull();
  });

  it('a failed delete reports a warning instead of dropping the rejection', async () => {
    mockMode = 'sentences';
    deleteModels.mockRejectedValueOnce(new Error('disk full'));
    useSegmentationStore.setState({ phase: 'missing', downloadedBytes: PACK_MODELS[1].sizeBytes });
    renderSection();

    fireEvent.click(screen.getByText(/Delete models/));

    await vi.waitFor(() =>
      expect(reportWarningMock).toHaveBeenCalledWith(
        'Segmentation',
        expect.stringContaining('disk full'),
        expect.objectContaining({ dedupeKey: 'segmentation:delete' }),
      ),
    );
  });

  describe('low-memory devices', () => {
    it('cannot choose By sentences, and are told why', () => {
      setDeviceMemory(2);
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();

      expect(screen.getByText(/does not report enough memory/i)).toBeTruthy();
      const sentences = modeButton('By sentences');
      expect(sentences.disabled).toBe(true);
      fireEvent.click(sentences);
      expect(confirmation()).toBeNull();
      expect(setSegmentationMode).not.toHaveBeenCalled();
    });

    it('can still leave By sentences if they were already in it', () => {
      setDeviceMemory(2);
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
      renderSection();

      const off = modeButton('Off');
      expect(off.disabled).toBe(false);
      fireEvent.click(off);
      expect(setSegmentationMode).toHaveBeenCalledWith('off');
    });

    it('cannot start the download from the status line either', () => {
      // The mode control is not the only way in: a user who was already in By
      // sentences before the guard applied still sees the status line, whose
      // Download and Retry would spend 402 MB on a feature
      // `PunctuationRuntime.enabled` refuses to run.
      setDeviceMemory(2);
      mockMode = 'sentences';
      useSegmentationStore.setState({ phase: 'missing' });
      renderSection();

      const downloadBtn = screen.getByText('Download').closest('button')!;
      expect(downloadBtn.disabled).toBe(true);
      fireEvent.click(downloadBtn);
      expect(confirmation()).toBeNull();

      cleanup();
      useSegmentationStore.setState({ phase: 'error', error: 'network down' });
      renderSection();

      const retryBtn = screen.getByText('Retry').closest('button')!;
      expect(retryBtn.disabled).toBe(true);
      fireEvent.click(retryBtn);
      expect(download).not.toHaveBeenCalled();
    });

    it('honours the debug:device-memory override the runtime uses', () => {
      setDeviceMemory(8);
      localStorage.setItem('debug:device-memory', '2');
      renderSection();
      expect(screen.getByText(/does not report enough memory/i)).toBeTruthy();
    });
  });

  it('disables the download actions and the delete link during a session', () => {
    mockMode = 'sentences';
    useSegmentationStore.setState({ phase: 'error', error: 'network down' });
    renderSection(true);
    expect(screen.getByText('Retry').closest('button')!.disabled).toBe(true);

    cleanup();
    useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1024 });
    renderSection(true);
    expect(screen.getByTestId('segmentation-download-cancel')).toHaveProperty('disabled', true);

    cleanup();
    useSegmentationStore.setState({ phase: 'missing', downloadedBytes: 1024 });
    renderSection(true);
    expect(screen.getByText('Download').closest('button')!.disabled).toBe(true);

    // The delete link lives in By sentences, which is where the session must
    // also keep it from being pressed.
    cleanup();
    useSegmentationStore.setState({ phase: 'missing', downloadedBytes: 1024 });
    renderSection(true);
    expect(screen.getByText(/Delete models/).closest('button')!.disabled).toBe(true);
  });
});
