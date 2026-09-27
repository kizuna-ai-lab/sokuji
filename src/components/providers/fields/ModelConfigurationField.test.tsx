import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
const tooltips: unknown[] = [];
vi.mock('../../Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));

import { ModelConfigurationField } from './ModelConfigurationField';

const T = { min: 0, max: 2, step: 0.1 };
const M = { min: 1, max: 8192, step: 1 };

describe('ModelConfigurationField', () => {
  it('the temperature slider runs the range and writes a number', () => {
    const onChange = vi.fn();
    render(
      <ModelConfigurationField temperature={0.8} maxTokens="inf" temperatureRange={T} maxTokensRange={M} onChange={onChange} />
    );
    const slider = screen.getByLabelText('settings.temperature') as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('2');
    expect(slider.step).toBe('0.1');
    expect(screen.getByText('0.80')).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '1.3' } });
    expect(onChange).toHaveBeenCalledWith({ temperature: 1.3 });
    expect(tooltips).toContain('settings.temperatureTooltip');
    expect(tooltips).toContain('settings.maxTokensTooltip');
  });

  it("unlimited shows no max-tokens slider; unticking it sets the range's maximum", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ModelConfigurationField temperature={0.8} maxTokens="inf" temperatureRange={T} maxTokensRange={M} onChange={onChange} />
    );
    const checkbox = screen.getByLabelText('Unlimited') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.queryByLabelText('settings.maxTokens')).toBeNull();
    const values = container.querySelectorAll('.setting-value');
    expect(values[1]?.textContent).toBe('Unlimited');
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ maxTokens: 8192 });
  });

  it('a number shows the slider, writing an integer; ticking Unlimited writes inf', () => {
    const onChange = vi.fn();
    render(
      <ModelConfigurationField temperature={0.8} maxTokens={2048} temperatureRange={T} maxTokensRange={M} onChange={onChange} />
    );
    const slider = screen.getByLabelText('settings.maxTokens') as HTMLInputElement;
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('8192');
    expect(slider.value).toBe('2048');
    fireEvent.change(slider, { target: { value: '4096' } });
    expect(onChange).toHaveBeenCalledWith({ maxTokens: 4096 });
    const checkbox = screen.getByLabelText('Unlimited') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ maxTokens: 'inf' });
  });

  it('disabled locks the sliders and the checkbox', () => {
    render(
      <ModelConfigurationField
        temperature={0.8}
        maxTokens={2048}
        temperatureRange={T}
        maxTokensRange={M}
        onChange={vi.fn()}
        disabled
      />
    );
    expect(screen.getByLabelText('settings.temperature')).toBeDisabled();
    expect(screen.getByLabelText('settings.maxTokens')).toBeDisabled();
    expect(screen.getByLabelText('Unlimited')).toBeDisabled();
  });
});
