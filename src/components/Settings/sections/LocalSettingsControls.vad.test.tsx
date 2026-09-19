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
    const slider = container.querySelector('input[type="range"][max="60"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith({ vadMaxSpeechDuration: 45 });
  });
});
