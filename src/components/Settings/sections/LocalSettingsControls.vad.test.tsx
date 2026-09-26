import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VadControl } from './LocalSettingsControls';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

const BASE = { vadThreshold: 0.3, vadMinSilenceDuration: 1.4, vadMinSpeechDuration: 0.4 };

describe('VadControl max speech duration', () => {
  it('shows the slider when the provider passes a value', () => {
    render(<VadControl values={{ ...BASE, vadMaxSpeechDuration: 30 }} onChange={() => {}} disabled={false} />);
    expect(screen.getByText('Max Speech Duration')).toBeTruthy();
    expect(screen.getByText('30s')).toBeTruthy();
  });

  // The sherpa-onnx engine and the Local Native sidecar cut at fixed lengths
  // of their own and never read this value: a slider there would be a dial
  // wired to nothing.
  it('hides the slider when the value is omitted', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} />);
    expect(screen.queryByText('Max Speech Duration')).toBeNull();
  });

  it('reports a change in whole seconds', () => {
    const onChange = vi.fn();
    const { container } = render(
      <VadControl values={{ ...BASE, vadMaxSpeechDuration: 30 }} onChange={onChange} disabled={false} />,
    );
    const slider = container.querySelector('input[type="range"][max="40"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '35' } });
    expect(onChange).toHaveBeenCalledWith({ vadMaxSpeechDuration: 35 });
  });

  // 60 would promise what no engine delivers: only cohere transcribes a
  // segment that long, and every other worker holds itself to 29-40 s.
  it('stops at 40 seconds', () => {
    const { container } = render(
      <VadControl values={{ ...BASE, vadMaxSpeechDuration: 30 }} onChange={() => {}} disabled={false} />,
    );
    const sliders = [...container.querySelectorAll('input[type="range"]')] as HTMLInputElement[];
    const maxSpeech = sliders.find((s) => s.step === '5' && s.value === '30');
    expect(maxSpeech?.max).toBe('40');
    expect(maxSpeech?.min).toBe('10');
  });
});

describe('VadControl heading', () => {
  // Default unchanged: every caller that doesn't know about `hideHeading`
  // (both inline blocks left in ProviderSpecificSettings.tsx) keeps showing it.
  it('shows the "VAD Settings" heading by default', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} />);
    expect(screen.getByText('VAD Settings')).toBeTruthy();
  });

  // LocalInference's disclosure row (Speech section) now carries the heading
  // words and its tooltip itself — Controls would otherwise repeat both
  // right under the row that already says them.
  it('omits the heading when hideHeading is passed, while still showing the sliders', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} hideHeading />);
    expect(screen.queryByText('VAD Settings')).toBeNull();
    expect(screen.getByText('Speech Threshold')).toBeTruthy();
    expect(screen.getByText('Min Silence Duration')).toBeTruthy();
    expect(screen.getByText('Min Speech Duration')).toBeTruthy();
  });
});
