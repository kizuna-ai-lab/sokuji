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

describe('VadControl pre-speech padding', () => {
  it('shows the slider when the provider passes a value', () => {
    render(<VadControl values={{ ...BASE, vadPreSpeechPadDuration: 0.8 }} onChange={() => {}} disabled={false} />);
    expect(screen.getByText('Pre-Speech Padding')).toBeTruthy();
    expect(screen.getByText('0.80s')).toBeTruthy();
  });

  // The sherpa-onnx engine takes its own fixed look-back before detected
  // speech and has no setting for it.
  it('hides the slider when the value is omitted', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} />);
    expect(screen.queryByText('Pre-Speech Padding')).toBeNull();
  });

  it('runs from no padding to two seconds and reports a change', () => {
    const onChange = vi.fn();
    const { container } = render(
      <VadControl values={{ ...BASE, vadPreSpeechPadDuration: 0.8 }} onChange={onChange} disabled={false} />,
    );
    const slider = [...container.querySelectorAll('input[type="range"]')]
      .find((s) => (s as HTMLInputElement).value === '0.8') as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('2');
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(onChange).toHaveBeenCalledWith({ vadPreSpeechPadDuration: 0.3 });
  });
});

describe('VadControl heading', () => {
  it('shows the "VAD Settings" heading', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} />);
    expect(screen.getByText('VAD Settings')).toBeTruthy();
  });
});
