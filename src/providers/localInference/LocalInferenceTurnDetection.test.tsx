import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

const mockResolve = vi.fn();
vi.mock('../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ resolve: mockResolve }) },
  useModelStatuses: () => ({}),
}));

let mockAsrEntry: { type?: string; asrWorkerType?: string } | undefined;
vi.mock('../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => (id === 'asr-model' ? mockAsrEntry : undefined),
}));

import { LocalInferenceTurnDetectionControls, LocalInferenceTurnDetectionHelp, LocalInferenceTurnDetectionSummary } from './LocalInferenceTurnDetection';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';

const pair = { source: 'ja', target: 'en' };

/** The range input in the VAD row labelled `label`. */
const sliderFor = (label: string) => screen.getByText(label).closest('.setting-item')!.querySelector('input[type="range"]') as HTMLInputElement;

beforeEach(() => {
  mockResolve.mockReset();
  mockAsrEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
  mockResolve.mockImplementation(() => ({ asr: { modelId: 'asr-model' }, translation: null, tts: null }));
});

describe('LocalInferenceTurnDetectionSummary', () => {
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
  // disclosure button rather than nested inside it.
  it('is text only — no tooltip trigger', () => {
    const { container } = render(
      <LocalInferenceTurnDetectionSummary settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />,
    );
    expect(container.querySelector('.tooltip-trigger')).toBeNull();
  });
});

describe('LocalInferenceTurnDetectionHelp', () => {
  // The heading's own tooltip, moved here from VadControl's now-hidden
  // heading — same content, same `Tooltip`. The Speech section renders this
  // as a sibling of its disclosure button, never nested inside it.
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

  // The Speech section's disclosure row already says "VAD Settings" (the
  // Summary, right above) — Controls repeating it right underneath was the
  // stutter this fix removes.
  it('omits the "VAD Settings" heading — the disclosure row above already says it', () => {
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.queryByText('VAD Settings')).toBeNull();
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
  });

  it('adds max speech and the silence threshold for a vad-web worker', () => {
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByText('Max Speech Duration')).toBeTruthy();
    expect(screen.getByText('Silence Threshold')).toBeTruthy();
  });

  it('disables every slider', () => {
    const { container } = render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} disabled pair={pair} />);
    const sliders = container.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(5);
    for (const slider of sliders) expect(slider).toBeDisabled();
  });
});
