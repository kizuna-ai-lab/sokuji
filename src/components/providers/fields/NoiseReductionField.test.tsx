import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const tooltips: unknown[] = [];
vi.mock('../../Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));

import { NoiseReductionField } from './NoiseReductionField';

const MODES = ['None', 'Near field', 'Far field'] as const;

describe('NoiseReductionField', () => {
  it('is the old noise section: a heading with its tooltip, one select of the raw modes, writing the choice', () => {
    const onChange = vi.fn();
    const { container } = render(<NoiseReductionField value="Near field" options={MODES} onChange={onChange} />);
    expect(screen.getByRole('heading', { name: 'settings.noiseReduction' })).toBeInTheDocument();
    expect(tooltips).toContain('settings.noiseReductionTooltip');
    const select = screen.getByLabelText('settings.noiseReduction') as HTMLSelectElement;
    expect(select.className).toBe('select-dropdown');
    expect(select.closest('.setting-item')?.parentElement?.className).toBe('settings-section');
    expect(container.firstElementChild?.className).toBe('settings-section');
    expect(select.value).toBe('Near field');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([['None', 'None'], ['Near field', 'Near field'], ['Far field', 'Far field']]);
    fireEvent.change(select, { target: { value: 'Far field' } });
    expect(onChange).toHaveBeenCalledWith('Far field');
  });

  it('disabled disables it', () => {
    render(<NoiseReductionField value="None" options={MODES} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('settings.noiseReduction')).toBeDisabled();
  });
});
