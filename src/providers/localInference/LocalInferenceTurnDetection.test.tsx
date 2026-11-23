import { describe, it, expect, vi, beforeEach } from 'vitest';

const { persistSetting } = vi.hoisted(() => ({ persistSetting: vi.fn(async () => {}) }));
vi.mock('../../services/persistSetting', () => ({ persistSetting }));
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
vi.mock('../../lib/local-inference/modelManifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/local-inference/modelManifest')>();
  return {
    ...actual,
    getManifestEntry: (id: string) => (id === 'asr-model' ? mockAsrEntry : id === 'reverse-asr-model' ? mockReverseEntry : actual.getManifestEntry(id)),
  };
});

let mockPhase = 'ready';
let mockBytes = 0;
let mockError: string | null = null;
const mockRefresh = vi.fn();
const mockDownload = vi.fn();
const mockDismiss = vi.fn();
const mockRemove = vi.fn();
vi.mock('../../stores/smartTurnStore', () => {
  const state = () => ({ phase: mockPhase, downloadedBytes: mockBytes, error: mockError, refresh: mockRefresh, download: mockDownload, dismiss: mockDismiss, remove: mockRemove });
  return {
    useSmartTurnStore: Object.assign((select: (s: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }),
    useSmartTurnPhase: () => mockPhase,
    SMART_TURN_TOTAL_BYTES: 32_411_198,
  };
});

const mockReportWarning = vi.fn();
vi.mock('../../lib/diagnostics/report', async () => {
  const actual = await vi.importActual<typeof import('../../lib/diagnostics/report')>('../../lib/diagnostics/report');
  return { ...actual, reportWarning: (...args: unknown[]) => mockReportWarning(...args) };
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
import { useTurnDetectionStore } from '../../stores/turnDetectionStore';
import { TURN_DETECTION_DEFAULTS } from '../../lib/turn/turnDetectionSettings';

const pair = { source: 'ja', target: 'en' };
const props = { settings: LOCAL_INFERENCE_DEFAULTS, update: () => {}, pair };
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const sliderFor = (label: string) => screen.getByText(label).closest('.setting-item')!.querySelector('input[type="range"]') as HTMLInputElement;

beforeEach(() => {
  persistSetting.mockClear();
  useTurnDetectionStore.setState({ settings: TURN_DETECTION_DEFAULTS });
  mockResolve.mockReset();
  mockPhase = 'ready';
  mockBytes = 0;
  mockError = null;
  mockRefresh.mockReset();
  mockDownload.mockReset().mockImplementation(async () => { mockPhase = 'ready'; });
  mockDismiss.mockReset();
  mockAsrEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
  mockReverseEntry = undefined;
  mockResolve.mockImplementation((source: string) => ({
    asr: { modelId: source === 'ja' ? 'asr-model' : 'reverse-asr-model' }, translation: null, tts: null,
  }));
  mockTurnMode = 'auto';
  mockLegs = ['speaker'];
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockReportWarning.mockReset();
});

describe('LocalInferenceTurnDetection reads the values from the turn detection store', () => {
  it('the Summary follows the store, not the provider settings', () => {
    useTurnDetectionStore.setState({ settings: { ...TURN_DETECTION_DEFAULTS, minSilence: 0.8 } });
    const { container } = render(<LocalInferenceTurnDetectionSummary {...props} />);
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 0.80s');
  });

  it('the Summary reads VAD Settings · Smart · Max Wait in Smart, and Normal when the model is gone', () => {
    useTurnDetectionStore.setState({ settings: { ...TURN_DETECTION_DEFAULTS, endOfTurn: 'smart' } });
    const { container, unmount } = render(<LocalInferenceTurnDetectionSummary {...props} />);
    expect(container.textContent).toBe('VAD Settings · Smart · Max Wait 1.40s');
    unmount();
    mockPhase = 'missing';
    const again = render(<LocalInferenceTurnDetectionSummary {...props} />);
    expect(again.container.textContent).toBe('VAD Settings · Min Silence Duration: 1.40s');
  });

  it("the Controls' change goes to settings.turnDetection through the store", () => {
    render(<LocalInferenceTurnDetectionControls {...props} />);
    const minSilence = sliderFor('Min Silence Duration');
    expect(minSilence.value).toBe(String(TURN_DETECTION_DEFAULTS.minSilence));
    fireEvent.change(minSilence, { target: { value: '0.5' } });
    expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.minSilence', 0.5);
    expect(useTurnDetectionStore.getState().settings.minSilence).toBe(0.5);
  });

  it('the Help carries the heading tooltip', () => {
    const { container } = render(<LocalInferenceTurnDetectionHelp {...props} />);
    expect(container.querySelector('.tooltip-trigger')).toBeTruthy();
  });

  it("resolves the speaker direction's ASR from the provider's selections", () => {
    render(<LocalInferenceTurnDetectionSummary {...props} />);
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', LOCAL_INFERENCE_DEFAULTS.selections);
  });
});

describe('LocalInferenceTurnDetection shows nothing when no leg takes our settings', () => {
  it.each([
    ['Summary', LocalInferenceTurnDetectionSummary],
    ['Help', LocalInferenceTurnDetectionHelp],
    ['Controls', LocalInferenceTurnDetectionControls],
  ])('%s, for a streaming ASR with no worker type', (_name, Component) => {
    mockAsrEntry = { type: 'asr-stream', asrWorkerType: undefined };
    const { container } = render(<Component {...props} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('LocalInferenceTurnDetection legs', () => {
  it('shows all six sliders for a model that cuts its own turns', () => {
    mockAsrEntry = { type: 'asr', asrWorkerType: 'sherpa-onnx' };
    const { container } = render(<LocalInferenceTurnDetectionControls {...props} />);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(6);
    expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
  });

  it('offers Normal / Smart for an automatic speaker on a shared model', () => {
    render(<LocalInferenceTurnDetectionControls {...props} />);
    expect(button('Normal').className).toContain('active');
    expect(button('Smart')).toBeTruthy();
  });

  it('offers it through the participant leg alone when the speaker is on a model of its own', () => {
    mockAsrEntry = { type: 'asr', asrWorkerType: 'sherpa-onnx' };
    mockReverseEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
    mockLegs = ['speaker', 'participant'];
    render(<LocalInferenceTurnDetectionControls {...props} />);
    expect(button('Smart')).toBeTruthy();
  });

  it('offers no choice for the participant when no participant leg runs', () => {
    mockAsrEntry = { type: 'asr', asrWorkerType: 'sherpa-onnx' };
    mockReverseEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
    render(<LocalInferenceTurnDetectionControls {...props} />);
    expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
  });

  it.each(['push-to-talk', 'push-to-translate'])('offers no choice under %s with no participant leg, and the summary reads Normal', (turnMode) => {
    mockTurnMode = turnMode;
    useTurnDetectionStore.setState({ settings: { ...TURN_DETECTION_DEFAULTS, endOfTurn: 'smart' } });
    render(<LocalInferenceTurnDetectionControls {...props} />);
    expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
    expect(screen.queryByText('Turn Check After')).toBeNull();
    cleanup();
    render(<LocalInferenceTurnDetectionSummary {...props} />);
    expect(screen.getByText('VAD Settings · Min Silence Duration: 1.40s')).toBeTruthy();
  });

  it('offers it under push-to-talk when the participant leg runs a shared model', () => {
    mockTurnMode = 'push-to-talk';
    mockLegs = ['speaker', 'participant'];
    mockReverseEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
    render(<LocalInferenceTurnDetectionControls {...props} />);
    expect(button('Smart')).toBeTruthy();
  });

  it('asks the disk for the Smart Turn model while its phase is unknown and a leg offers Smart', () => {
    mockPhase = 'unknown';
    render(<LocalInferenceTurnDetectionControls {...props} />);
    expect(mockRefresh).toHaveBeenCalled();
  });
});
