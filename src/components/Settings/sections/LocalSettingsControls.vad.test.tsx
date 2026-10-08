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

describe('VadControl Smart Turn sliders', () => {
  const SMART = { ...BASE, smartTurnCheckAfter: 0.3, smartTurnThreshold: 0.5 };
  const sliderFor = (label: string) => screen.getByText(label).closest('.setting-item')!.querySelector('input[type="range"]') as HTMLInputElement;

  it('are hidden, and Min Silence keeps its name, when the provider passes no Smart Turn values', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} />);
    expect(screen.queryByText('Turn Check After')).toBeNull();
    expect(screen.queryByText('Turn Threshold')).toBeNull();
    expect(screen.getByText('Min Silence Duration')).toBeTruthy();
  });

  it('show both sliders above Speech Threshold and call Min Silence "Max Wait"', () => {
    render(<VadControl values={SMART} onChange={() => {}} disabled={false} />);
    expect(screen.getByText('0.30s')).toBeTruthy();
    expect(screen.getByText('0.50')).toBeTruthy();
    expect(screen.getByText('Max Wait')).toBeTruthy();
    expect(screen.queryByText('Min Silence Duration')).toBeNull();
    const order = screen.getByText('Turn Check After').compareDocumentPosition(screen.getByText('Speech Threshold'));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('run 0.10–0.50 s and 0.30–0.90', () => {
    render(<VadControl values={SMART} onChange={() => {}} disabled={false} />);
    expect([sliderFor('Turn Check After').min, sliderFor('Turn Check After').max]).toEqual(['0.1', '0.5']);
    expect([sliderFor('Turn Threshold').min, sliderFor('Turn Threshold').max]).toEqual(['0.3', '0.9']);
  });

  it('hold Max Wait at 0.30 s or more, and give Min Silence its full range under Normal', () => {
    const { unmount } = render(<VadControl values={SMART} onChange={() => {}} disabled={false} />);
    expect(sliderFor('Max Wait').min).toBe('0.3');
    unmount();
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} />);
    expect(sliderFor('Min Silence Duration').min).toBe('0.05');
  });

  it('hold Turn Check After 0.2 s under Max Wait, showing what the session will use', () => {
    render(<VadControl values={{ ...SMART, vadMinSilenceDuration: 0.4, smartTurnCheckAfter: 0.5 }} onChange={() => {}} disabled={false} />);
    expect(sliderFor('Turn Check After').max).toBe('0.2');
    expect(screen.getByText('0.20s')).toBeTruthy();
  });

  it('show a dash when Max Wait leaves no room for Smart Turn', () => {
    render(<VadControl values={{ ...SMART, vadMinSilenceDuration: 0.25 }} onChange={() => {}} disabled={false} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('report their changes', () => {
    const onChange = vi.fn();
    render(<VadControl values={SMART} onChange={onChange} disabled={false} />);
    fireEvent.change(sliderFor('Turn Check After'), { target: { value: '0.2' } });
    fireEvent.change(sliderFor('Turn Threshold'), { target: { value: '0.7' } });
    expect(onChange).toHaveBeenCalledWith({ smartTurnCheckAfter: 0.2 });
    expect(onChange).toHaveBeenCalledWith({ smartTurnThreshold: 0.7 });
  });

  it('render the end-of-turn choice under the heading, above every slider', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} endOfTurn={<div data-testid="end-of-turn" />} />);
    const order = screen.getByTestId('end-of-turn').compareDocumentPosition(screen.getByText('Speech Threshold'));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
