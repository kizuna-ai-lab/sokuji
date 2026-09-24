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

import { LocalInferenceSettingsView } from './LocalInferenceSettings';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';

const pair = { source: 'ja', target: 'en' };

beforeEach(() => {
  mockResolve.mockReset();
  mockAsrEntry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
  mockResolve.mockImplementation(() => ({
    asr: { modelId: 'asr-model' },
    translation: null,
    tts: null,
  }));
});

describe('LocalInferenceSettingsView', () => {
  it('renders the speed, prompt and VAD controls', () => {
    render(<LocalInferenceSettingsView settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByLabelText('Speech Speed')).toBeTruthy();
    expect(screen.getByText('Translation Prompt')).toBeTruthy();
    expect(screen.getByText('VAD Settings')).toBeTruthy();
  });

  it('changing the speed calls update({ ttsSpeed })', () => {
    const update = vi.fn();
    render(<LocalInferenceSettingsView settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={pair} />);
    fireEvent.change(screen.getByLabelText('Speech Speed'), { target: { value: '1.5' } });
    expect(update).toHaveBeenCalledWith({ ttsSpeed: 1.5 });
  });

  it('disables every control', () => {
    render(<LocalInferenceSettingsView settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} disabled pair={pair} />);
    expect(screen.getByLabelText('Speech Speed')).toBeDisabled();
  });

  // Today's rule (ProviderSpecificSettings.tsx): a streaming ASR that reports
  // no worker type uses endpoint detection instead of VAD — the slider is
  // useless there and hidden. A streaming ASR WITH a worker type (sherpa-onnx)
  // still uses vad-web underneath and keeps the slider.
  it('hides the VAD knobs for a streaming ASR with no worker type', () => {
    mockAsrEntry = { type: 'asr-stream', asrWorkerType: undefined };
    render(<LocalInferenceSettingsView settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.queryByText('VAD Settings')).toBeNull();
  });

  it('keeps the VAD knobs for a streaming ASR that does report a worker type', () => {
    mockAsrEntry = { type: 'asr-stream', asrWorkerType: 'sherpa-onnx' };
    render(<LocalInferenceSettingsView settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByText('VAD Settings')).toBeTruthy();
  });
});
