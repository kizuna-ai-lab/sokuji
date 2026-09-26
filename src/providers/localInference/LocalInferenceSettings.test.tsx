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
  it('renders the speed and prompt controls', () => {
    render(<LocalInferenceSettingsView settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByLabelText('Speech Speed')).toBeTruthy();
    expect(screen.getByText('Translation Prompt')).toBeTruthy();
  });

  // The VAD knobs are the provider's `TurnDetection` now, drawn in the Speech
  // section while the turn mode is Auto (LocalInferenceTurnDetection.test.tsx
  // pins their rules) — never twice.
  it('no longer draws the VAD knobs, even for an ASR that takes all five', () => {
    const { container } = render(<LocalInferenceSettingsView settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.queryByText('VAD Settings')).toBeNull();
    expect(screen.queryByText('Min Silence Duration')).toBeNull();
    // The one slider left is the speech speed.
    expect([...container.querySelectorAll('input[type="range"]')].map((el) => el.getAttribute('aria-label'))).toEqual(['Speech Speed']);
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
});
