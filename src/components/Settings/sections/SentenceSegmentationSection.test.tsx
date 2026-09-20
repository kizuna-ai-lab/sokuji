/**
 * SentenceSegmentationSection — the settings surface for the punctuation
 * stage after A1: an on/off toggle that asks once before downloading all
 * three models, one status line for that single download, the 1-5 "sentences
 * per bubble" control, and a delete link. There are no per-model rows any
 * more; the pack is one thing to the user and one thing here.
 *
 * `segmentationStore` is the REAL store, with its four actions swapped for
 * spies through `setState` — the store keeps its real `PACK_MODELS` and
 * `PACK_TOTAL_BYTES` (so every size asserted below comes from the manifest,
 * not a literal) while nothing reaches IndexedDB. `settingsStore` is mocked
 * with just the four hooks this component calls (house pattern, see
 * HelpSection.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

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

let mockSentenceSegmentation = false;
const setSentenceSegmentation = vi.fn();
let mockChunkSentences = 3;
const setChunkSentences = vi.fn();

vi.mock('../../../stores/settingsStore', () => ({
  useSentenceSegmentation: () => mockSentenceSegmentation,
  useSetSentenceSegmentation: () => setSentenceSegmentation,
  useSentenceSegmentationChunkSentences: () => mockChunkSentences,
  useSetSentenceSegmentationChunkSentences: () => setChunkSentences,
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

const refresh = vi.fn();
const download = vi.fn();
const cancel = vi.fn();
const deleteModels = vi.fn();

/** navigator.deviceMemory is undefined in jsdom, which `isLowMemoryDevice`
 *  reads as exactly the 4GB threshold — i.e. low-memory. Every test but the
 *  low-memory one needs a value above it, or the toggle renders disabled
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

/** The shared ToggleSwitch renders role="switch" with no accessible name from
 *  content, so — as LanguageSection.textOnly.test.tsx does — match on
 *  textContent instead of the `name` option. */
const segmentationToggle = () =>
  screen.getAllByRole('switch').find((el) => el.textContent?.includes('Subtitle segmentation'))!;

const chunkButton = (n: number) =>
  screen.getAllByText(String(n)).find((el) => el.tagName === 'BUTTON') as HTMLButtonElement;

const confirmation = () => screen.queryByRole('dialog');

beforeEach(() => {
  cleanup();
  setDeviceMemory(8);
  mockSentenceSegmentation = false;
  mockChunkSentences = 3;
  setSentenceSegmentation.mockClear();
  setChunkSentences.mockClear();
  refresh.mockReset().mockResolvedValue(undefined);
  download.mockReset().mockResolvedValue(undefined);
  cancel.mockReset();
  deleteModels.mockReset().mockResolvedValue(undefined);
  reportWarningMock.mockClear();
  trackEvent.mockClear();
  useSegmentationStore.setState({
    phase: 'unknown',
    downloadedBytes: 0,
    error: null,
    refresh,
    download,
    cancel,
    deleteModels,
  });
  localStorage.removeItem('debug:device-memory');
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

  it('turning the toggle on with no models opens the confirmation and does not enable yet', () => {
    useSegmentationStore.setState({ phase: 'missing' });
    renderSection();
    expect(confirmation()).toBeNull();

    fireEvent.click(segmentationToggle());

    expect(confirmation()).not.toBeNull();
    expect(screen.getByText('Download segmentation models')).toBeTruthy();
    expect(setSentenceSegmentation).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('confirming enables the setting and starts the download', () => {
    useSegmentationStore.setState({ phase: 'missing' });
    renderSection();
    fireEvent.click(segmentationToggle());

    fireEvent.click(screen.getByText(`Download ${formatBytes(PACK_TOTAL_BYTES)}`));

    expect(setSentenceSegmentation).toHaveBeenCalledWith(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(confirmation()).toBeNull();
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
      fireEvent.click(segmentationToggle());
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
      mockSentenceSegmentation = true;
      useSegmentationStore.setState({ phase: 'error', error: 'network down' });
      renderSection();

      download.mockImplementation(async () => { useSegmentationStore.setState({ phase: 'ready' }); });
      fireEvent.click(screen.getByText('Retry'));
      await vi.waitFor(() => expect(trackEvent).toHaveBeenCalled());
      expect(trackEvent.mock.calls[0][1].result).toBe('ok');
    });
  });

  it('cancelling the confirmation leaves the setting off', () => {
    useSegmentationStore.setState({ phase: 'missing' });
    renderSection();
    fireEvent.click(segmentationToggle());

    fireEvent.click(screen.getByText('Cancel'));

    expect(confirmation()).toBeNull();
    expect(setSentenceSegmentation).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('turning the toggle on when the models are ready enables it without asking', () => {
    useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
    renderSection();

    fireEvent.click(segmentationToggle());

    expect(setSentenceSegmentation).toHaveBeenCalledWith(true);
    expect(confirmation()).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it('shows progress and a cancel action while downloading', () => {
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 100 * 1024 * 1024 });
    renderSection();

    expect(screen.getByText(`Downloading 100.0 MB of ${formatBytes(PACK_TOTAL_BYTES)}`)).toBeTruthy();
    const fill = screen.getByTestId('segmentation-progress-fill');
    expect(fill.style.width).toBe(`${(100 * 1024 * 1024 / PACK_TOTAL_BYTES) * 100}%`);
    expect(screen.getByTestId('segmentation-download-cancel')).toBeTruthy();
  });

  it('cancelling the download turns the setting back off', () => {
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1024 });
    renderSection();

    fireEvent.click(screen.getByTestId('segmentation-download-cancel'));

    expect(setSentenceSegmentation).toHaveBeenCalledWith(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    // cancel() leaves downloadedBytes counting bytes that were fetched but not
    // necessarily stored as whole models, so the disk has to be re-asked or the
    // delete link would offer a size that isn't there.
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('shows the error and a retry action after a failed download', () => {
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'error', error: 'network down' });
    renderSection();

    expect(screen.getByText('Download failed: network down')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(download).toHaveBeenCalledTimes(1);
    // A retry resumes over what is already there; it never re-asks.
    expect(confirmation()).toBeNull();
  });

  it('offers Download again when the setting is on but the files are missing', () => {
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'missing' });
    renderSection();

    expect(screen.getByText('The models are not on this device.')).toBeTruthy();
    fireEvent.click(screen.getByText('Download'));
    expect(confirmation()).not.toBeNull();
  });

  it('says nothing under the toggle while the phase is still unknown', () => {
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'unknown' });
    renderSection();

    expect(screen.queryByText('The models are not on this device.')).toBeNull();
    expect(screen.queryByTestId('segmentation-progress-fill')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('says nothing under the toggle once the pack is ready', () => {
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
    renderSection();

    expect(screen.queryByText('The models are not on this device.')).toBeNull();
    expect(screen.queryByTestId('segmentation-progress-fill')).toBeNull();
  });

  it('disables the sentences-per-bubble control until the models are ready', () => {
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'missing' });
    renderSection();
    for (let n = 1; n <= 5; n++) expect(chunkButton(n).disabled).toBe(true);

    cleanup();
    useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
    renderSection();
    for (let n = 1; n <= 5; n++) expect(chunkButton(n).disabled).toBe(false);
    fireEvent.click(chunkButton(5));
    expect(setChunkSentences).toHaveBeenCalledWith(5);
  });

  it('offers a delete link, with the size, only when the setting is off and files exist', () => {
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

    // On, with files: the pack is in use, so it is not offered either.
    cleanup();
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
    renderSection();
    expect(screen.queryByText(/Delete models/)).toBeNull();
  });

  it('a failed delete reports a warning instead of dropping the rejection', async () => {
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

  it('cannot be turned on on a low-memory device, and says why', () => {
    setDeviceMemory(2);
    useSegmentationStore.setState({ phase: 'missing' });
    renderSection();

    expect(screen.getByText(/does not report enough memory/i)).toBeTruthy();
    const toggle = segmentationToggle();
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(toggle);
    expect(confirmation()).toBeNull();
    expect(setSentenceSegmentation).not.toHaveBeenCalled();
  });

  it('a low-memory device cannot start the download from the status line either', () => {
    // The toggle is not the only way in: a user who had the setting on before
    // the guard applied still sees the status line, whose Download and Retry
    // spend 402 MB on a feature `PunctuationRuntime.enabled` refuses to run.
    setDeviceMemory(2);
    mockSentenceSegmentation = true;
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

  it('a settings write that rolls back mid-download keeps Cancel and withholds the delete link', () => {
    // `setSentenceSegmentation` writes the value, then rolls it back when
    // `persistSetting` returns false — while the download it started keeps
    // running. Gating the status line on the setting alone would take Cancel
    // away with it and put the delete link up over a live fetch.
    useSegmentationStore.setState({ phase: 'missing' });
    const { rerender } = renderSection();
    fireEvent.click(segmentationToggle());
    fireEvent.click(screen.getByText(`Download ${formatBytes(PACK_TOTAL_BYTES)}`));
    expect(download).toHaveBeenCalledTimes(1);

    useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1024 });
    mockSentenceSegmentation = false; // the persist failed and rolled it back
    rerender(<SentenceSegmentationSection isSessionActive={false} />);

    expect(screen.getByTestId('segmentation-download-cancel')).toBeTruthy();
    expect(screen.queryByText(/Delete models/)).toBeNull();
  });

  it('a user who already had it on can still turn it off on a low-memory device', () => {
    setDeviceMemory(2);
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
    renderSection();

    const toggle = segmentationToggle();
    expect(toggle.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(toggle);
    expect(setSentenceSegmentation).toHaveBeenCalledWith(false);
  });

  it('honours the debug:device-memory override the runtime uses', () => {
    setDeviceMemory(8);
    localStorage.setItem('debug:device-memory', '2');
    renderSection();
    expect(screen.getByText(/does not report enough memory/i)).toBeTruthy();
  });

  it('disables the toggle, the download actions and the delete link during a session', () => {
    mockSentenceSegmentation = true;
    useSegmentationStore.setState({ phase: 'error', error: 'network down' });
    renderSection(true);

    expect(segmentationToggle().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Retry').closest('button')!.disabled).toBe(true);

    cleanup();
    useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1024 });
    renderSection(true);
    expect(screen.getByTestId('segmentation-download-cancel')).toHaveProperty('disabled', true);

    cleanup();
    useSegmentationStore.setState({ phase: 'missing', downloadedBytes: 1024 });
    renderSection(true);
    expect(screen.getByText('Download').closest('button')!.disabled).toBe(true);

    cleanup();
    mockSentenceSegmentation = false;
    useSegmentationStore.setState({ phase: 'missing', downloadedBytes: 1024 });
    renderSection(true);
    expect(screen.getByText(/Delete models/).closest('button')!.disabled).toBe(true);
  });
});
