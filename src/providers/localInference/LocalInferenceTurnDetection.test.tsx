import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: string, opts?: Record<string, unknown>) =>
      (fb ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => String(opts?.[n] ?? '')),
  }),
}));

const mockResolve = vi.fn();
vi.mock('../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ resolve: mockResolve }) },
  useModelStatuses: () => ({}),
}));

let mockAsrEntry: { type?: string; asrWorkerType?: string } | undefined;
let mockReverseEntry: { type?: string; asrWorkerType?: string } | undefined;
vi.mock('../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => (id === 'asr-model' ? mockAsrEntry : id === 'reverse-asr-model' ? mockReverseEntry : undefined),
}));

let mockPhase = 'ready';
let mockBytes = 0;
let mockError: string | null = null;
const mockRefresh = vi.fn();
const mockDownload = vi.fn();
const mockDismiss = vi.fn();
vi.mock('../../stores/smartTurnStore', () => {
  const state = () => ({ phase: mockPhase, downloadedBytes: mockBytes, error: mockError, refresh: mockRefresh, download: mockDownload, dismiss: mockDismiss });
  return {
    useSmartTurnStore: Object.assign((select: (s: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }),
    useSmartTurnPhase: () => mockPhase,
    SMART_TURN_TOTAL_BYTES: 32_411_198,
  };
});

let mockTurnMode = 'auto';
let mockLegs: string[] = ['speaker'];
vi.mock('../../stores/turnModeStore', () => ({
  useTurnModeStore: (select: (s: { turnMode: string }) => unknown) => select({ turnMode: mockTurnMode }),
}));
vi.mock('../../stores/providerStore', () => ({
  useProviderStore: (select: (s: { legs: string[] }) => unknown) => select({ legs: mockLegs }),
}));

import { LocalInferenceTurnDetectionControls, LocalInferenceTurnDetectionHelp, LocalInferenceTurnDetectionSummary } from './LocalInferenceTurnDetection';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';

const pair = { source: 'ja', target: 'en' };

/** The range input in the VAD row labelled `label`. */
const sliderFor = (label: string) => screen.getByText(label).closest('.setting-item')!.querySelector('input[type="range"]') as HTMLInputElement;

beforeEach(() => {
  mockResolve.mockReset();
  mockPhase = 'ready';
  mockBytes = 0;
  mockError = null;
  mockRefresh.mockReset();
  mockDownload.mockReset().mockImplementation(async () => { mockPhase = 'ready'; });
  mockDismiss.mockReset().mockImplementation(() => { mockPhase = 'missing'; mockError = null; });
  mockAsrEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
  mockReverseEntry = undefined;
  mockResolve.mockImplementation(() => ({ asr: { modelId: 'asr-model' }, translation: null, tts: null }));
  mockTurnMode = 'auto';
  mockLegs = ['speaker'];
});

describe('LocalInferenceTurnDetectionSummary', () => {
  it('in Smart reads VAD Settings · Smart · Max Wait', () => {
    const { container } = render(
      <LocalInferenceTurnDetectionSummary settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadEndOfTurn: 'smart' }} update={() => {}} pair={pair} />,
    );
    expect(container.textContent).toBe('VAD Settings · Smart · Max Wait 1.40s');
  });

  it('summarizes a stored Smart whose model is gone as Normal', () => {
    mockPhase = 'missing';
    const { container } = render(
      <LocalInferenceTurnDetectionSummary settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadEndOfTurn: 'smart' }} update={() => {}} pair={pair} />,
    );
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 1.40s');
  });

  it('summarizes Smart as Normal when Max Wait leaves no room for Turn Check After', () => {
    const { container } = render(
      <LocalInferenceTurnDetectionSummary settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadEndOfTurn: 'smart', vadMinSilenceDuration: 0.25 }} update={() => {}} pair={pair} />,
    );
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 0.25s');
  });

  it("is one line: VadControl's heading and min-silence label, the value formatted as VadControl formats it", () => {
    const { container } = render(
      <LocalInferenceTurnDetectionSummary settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadMinSilenceDuration: 0.8 }} update={() => {}} pair={pair} />,
    );
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 0.80s');
  });

  it("reads the speaker direction's resolved ASR", () => {
    render(<LocalInferenceTurnDetectionSummary settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', LOCAL_INFERENCE_DEFAULTS.selections);
  });

  // Endpoint detection replaces VAD on a streaming ASR that reports no worker
  // type: there is nothing to tune, so nothing to summarize.
  it('renders nothing for a streaming ASR with no worker type', () => {
    mockAsrEntry = { type: 'asr-stream', asrWorkerType: undefined };
    const { container } = render(<LocalInferenceTurnDetectionSummary settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(container.innerHTML).toBe('');
  });

  // Text only — no tooltip trigger here. `LocalInferenceTurnDetectionHelp`
  // carries it instead, so the section can place it as a sibling of the
  // link button rather than nested inside it.
  it('is text only — no tooltip trigger', () => {
    const { container } = render(
      <LocalInferenceTurnDetectionSummary settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />,
    );
    expect(container.querySelector('.tooltip-trigger')).toBeNull();
  });
});

describe('LocalInferenceTurnDetectionHelp', () => {
  // The same tooltip VadControl's heading carries — same content, same
  // `Tooltip`. The Speech section renders this as a sibling of its summary
  // (Simple) or link button (Advanced), never nested inside the button.
  it('renders a tooltip trigger with the VAD settings tooltip content', () => {
    const { container } = render(
      <LocalInferenceTurnDetectionHelp settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />,
    );
    expect(container.querySelector('.tooltip-trigger')).toBeTruthy();
  });

  // Nothing to tune (a streaming ASR with no worker type): the Summary shows
  // nothing, and this must follow suit or the row would show a lone help
  // icon over an empty summary.
  it('renders nothing for a streaming ASR with no worker type', () => {
    mockAsrEntry = { type: 'asr-stream', asrWorkerType: undefined };
    const { container } = render(
      <LocalInferenceTurnDetectionHelp settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('LocalInferenceTurnDetectionControls', () => {
  it("renders VadControl's sliders over the settings, and a change goes through update", () => {
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={pair} />);
    const minSilence = sliderFor('Min Silence Duration');
    expect(minSilence.value).toBe(String(LOCAL_INFERENCE_DEFAULTS.vadMinSilenceDuration));
    fireEvent.change(minSilence, { target: { value: '0.5' } });
    expect(update).toHaveBeenCalledWith({ vadMinSilenceDuration: 0.5 });
  });

  // A block of its own on the Provider tab, away from the Speech section's
  // Summary: it names itself, with the heading's tooltip.
  it('shows the "VAD Settings" heading', () => {
    const { container } = render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(container.querySelector('h2')?.textContent).toBe('VAD Settings');
  });

  it('renders nothing for a streaming ASR with no worker type', () => {
    mockAsrEntry = { type: 'asr-stream', asrWorkerType: undefined };
    const { container } = render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(container.innerHTML).toBe('');
  });

  // Today's rules: a streaming ASR that does report a worker type
  // (sherpa-onnx) keeps the VAD knobs; the two vad-web-only knobs stay hidden
  // for it — the sherpa-onnx engine has its own hysteresis and cuts at a
  // fixed length.
  it('keeps the three shared knobs for a sherpa-onnx streaming ASR, without the two vad-web knobs', () => {
    mockAsrEntry = { type: 'asr-stream', asrWorkerType: 'sherpa-onnx' };
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByText('Speech Threshold')).toBeTruthy();
    expect(screen.getByText('Min Silence Duration')).toBeTruthy();
    expect(screen.getByText('Min Speech Duration')).toBeTruthy();
    expect(screen.queryByText('Max Speech Duration')).toBeNull();
    expect(screen.queryByText('Silence Threshold')).toBeNull();
    expect(screen.queryByText('Pre-Speech Padding')).toBeNull();
  });

  it('adds max speech, the silence threshold and the pre-speech padding for a vad-web worker', () => {
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByText('Max Speech Duration')).toBeTruthy();
    expect(screen.getByText('Silence Threshold')).toBeTruthy();
    expect(screen.getByText('Pre-Speech Padding')).toBeTruthy();
  });

  it('sends a pre-speech padding change through update', () => {
    const update = vi.fn();
    const { container } = render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={pair} />);
    const pad = [...container.querySelectorAll('input[type="range"]')]
      .find((s) => (s as HTMLInputElement).value === String(LOCAL_INFERENCE_DEFAULTS.vadPreSpeechPadDuration)) as HTMLInputElement;
    fireEvent.change(pad, { target: { value: '0.3' } });
    expect(update).toHaveBeenCalledWith({ vadPreSpeechPadDuration: 0.3 });
  });

  it('disables every slider', () => {
    const { container } = render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} disabled pair={pair} />);
    const sliders = container.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(6);
    for (const slider of sliders) expect(slider).toBeDisabled();
  });
});

describe('LocalInferenceTurnDetectionControls — Smart Turn', () => {
  const smart = { ...LOCAL_INFERENCE_DEFAULTS, vadEndOfTurn: 'smart' as const };
  const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('offers Normal and Smart for an ASR in its scope, Normal active by default', () => {
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(button('Normal').className).toContain('active');
    expect(button('Smart').className).not.toContain('active');
    expect(screen.queryByText('Turn Check After')).toBeNull();
  });

  it.each([
    [{ type: 'asr', asrWorkerType: 'sherpa-onnx' }],
    [{ type: 'asr-stream', asrWorkerType: 'voxtral-webgpu' }],
  ])('offers neither for %o', (entry) => {
    mockAsrEntry = entry;
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
  });

  it('offers both on a device that reports little memory', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');
    Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true });
    try {
      render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
      expect(button('Smart')).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(navigator, 'deviceMemory', original);
      else delete (navigator as any).deviceMemory;
    }
  });

  it('downloads first and switches to Smart only once the model is ready', async () => {
    mockPhase = 'missing';
    let finish!: () => void;
    mockDownload.mockImplementation(() => new Promise<void>((resolve) => { finish = () => { mockPhase = 'ready'; resolve(); }; }));
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={pair} />);
    fireEvent.click(button('Smart'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ vadEndOfTurn: 'smart' }));
  });

  it('raises Max Wait to 0.30 s with Smart when it was lower', async () => {
    mockPhase = 'missing';
    mockDownload.mockImplementation(async () => { mockPhase = 'ready'; });
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadMinSilenceDuration: 0.25 }} update={update} pair={pair} />);
    fireEvent.click(button('Smart'));
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ vadEndOfTurn: 'smart', vadMinSilenceDuration: 0.3 }));
  });

  it('keeps a Max Wait raised while the model downloaded', async () => {
    mockPhase = 'missing';
    let finish!: () => void;
    mockDownload.mockImplementation(() => new Promise<void>((resolve) => { finish = () => { mockPhase = 'ready'; resolve(); }; }));
    const update = vi.fn();
    const { rerender } = render(<LocalInferenceTurnDetectionControls settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadMinSilenceDuration: 0.25 }} update={update} pair={pair} />);
    fireEvent.click(button('Smart'));
    rerender(<LocalInferenceTurnDetectionControls settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadMinSilenceDuration: 0.8 }} update={update} pair={pair} />);
    finish();
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ vadEndOfTurn: 'smart' }));
  });

  it('stays on Normal when the download fails', async () => {
    mockPhase = 'missing';
    mockDownload.mockImplementation(async () => { mockPhase = 'error'; mockError = 'offline'; });
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={pair} />);
    fireEvent.click(button('Smart'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });

  it("shows the download's progress", () => {
    mockPhase = 'downloading';
    mockBytes = 16_205_599;
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByText('Downloading the Smart Turn model: 15.5 MB of 30.9 MB')).toBeTruthy();
    expect(button('Smart')).toBeDisabled();
  });

  it('shows a failed download with a retry that downloads again', () => {
    mockPhase = 'error';
    mockError = 'offline';
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByText('Smart Turn model download failed: offline')).toBeTruthy();
    fireEvent.click(button('Retry'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it('in Smart shows the two sliders and Max Wait, and their changes go through update', () => {
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={smart} update={update} pair={pair} />);
    expect(button('Smart').className).toContain('active');
    expect(screen.getByText('Max Wait')).toBeTruthy();
    expect(screen.queryByText('Min Silence Duration')).toBeNull();
    fireEvent.change(sliderFor('Turn Threshold'), { target: { value: '0.7' } });
    expect(update).toHaveBeenCalledWith({ smartTurnThreshold: 0.7 });
  });

  it('writes Normal when Normal is chosen from Smart', () => {
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={smart} update={update} pair={pair} />);
    fireEvent.click(button('Normal'));
    expect(update).toHaveBeenCalledWith({ vadEndOfTurn: 'normal' });
  });

  it('reads a stored Smart whose model is gone as Normal', () => {
    mockPhase = 'missing';
    render(<LocalInferenceTurnDetectionControls settings={smart} update={() => {}} pair={pair} />);
    expect(button('Normal').className).toContain('active');
    expect(screen.queryByText('Turn Check After')).toBeNull();
    expect(screen.getByText('Min Silence Duration')).toBeTruthy();
  });

  it('asks the disk while the phase is unknown', () => {
    mockPhase = 'unknown';
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('holds both buttons while a session runs', () => {
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} disabled pair={pair} />);
    expect(button('Normal')).toBeDisabled();
    expect(button('Smart')).toBeDisabled();
  });

  it('clears a failed download when Normal is chosen, even with Normal already stored', () => {
    mockPhase = 'error';
    mockError = 'offline';
    const props = { settings: LOCAL_INFERENCE_DEFAULTS, update: vi.fn(), pair };
    const { rerender } = render(<LocalInferenceTurnDetectionControls {...props} />);
    fireEvent.click(button('Normal'));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    rerender(<LocalInferenceTurnDetectionControls {...props} />);
    expect(screen.queryByText('Smart Turn model download failed: offline')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  describe('which legs can run it', () => {
    const reverseOnly = () => {
      mockAsrEntry = { type: 'asr', asrWorkerType: 'sherpa-onnx' };
      mockReverseEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
      mockResolve.mockImplementation((source: string) => ({
        asr: { modelId: source === 'ja' ? 'asr-model' : 'reverse-asr-model' }, translation: null, tts: null,
      }));
    };

    it('offers the choice when only the participant leg runs an ASR in scope', () => {
      reverseOnly();
      mockLegs = ['speaker', 'participant'];
      render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
      expect(button('Smart')).toBeTruthy();
      expect(screen.queryByText('Max Speech Duration')).toBeNull();
    });

    it('offers no choice for the reverse ASR when no participant leg runs', () => {
      reverseOnly();
      render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
      expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
    });

    it.each(['push-to-talk', 'push-to-translate'])('offers no choice under %s with no participant leg, and the summary reads Normal', (turnMode) => {
      mockTurnMode = turnMode;
      render(<LocalInferenceTurnDetectionControls settings={smart} update={() => {}} pair={pair} />);
      expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
      expect(screen.queryByText('Turn Check After')).toBeNull();
      cleanup();
      render(<LocalInferenceTurnDetectionSummary settings={smart} update={() => {}} pair={pair} />);
      expect(screen.getByText('VAD Settings · Min Silence Duration: 1.40s')).toBeTruthy();
    });

    it('offers it under push-to-talk when the participant leg runs an ASR in scope', () => {
      mockTurnMode = 'push-to-talk';
      mockLegs = ['speaker', 'participant'];
      mockReverseEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
      mockResolve.mockImplementation((source: string) => ({
        asr: { modelId: source === 'ja' ? 'asr-model' : 'reverse-asr-model' }, translation: null, tts: null,
      }));
      render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
      expect(button('Smart')).toBeTruthy();
    });
  });
});
