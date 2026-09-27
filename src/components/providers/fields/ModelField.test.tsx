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

import { ModelField } from './ModelField';

describe('ModelField', () => {
  it('lists the models it is handed, shows the chosen one, writes a choice, and counts them', () => {
    const onChange = vi.fn();
    const models = [{ id: 'm-new' }, { id: 'm-old' }];
    const { container } = render(<ModelField value="m-old" models={models} onChange={onChange} />);
    const select = screen.getByLabelText('settings.model') as HTMLSelectElement;
    expect(container.querySelector('.model-selection-container select.select-dropdown')).toBe(select);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['m-new', 'm-old']);
    expect(select.value).toBe('m-old');
    fireEvent.change(select, { target: { value: 'm-new' } });
    expect(onChange).toHaveBeenCalledWith('m-new');
    expect(container.querySelector('.models-info')?.textContent).toBe('Found 2 available models');
    expect(tooltips).toContain('settings.modelTooltip');
    expect(container.querySelector('.refresh-models-button')).toBeNull();
  });

  it('before a check has listed any: the saved model alone, locked, and no count', () => {
    const { container, rerender } = render(<ModelField value="m-saved" models={[]} onChange={vi.fn()} />);
    const select = screen.getByLabelText('settings.model') as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(select.options).toHaveLength(1);
    expect(select.options[0].value).toBe('m-saved');
    expect(container.querySelector('.models-info')).toBeNull();

    rerender(<ModelField value="" models={[]} onChange={vi.fn()} />);
    const select2 = screen.getByLabelText('settings.model') as HTMLSelectElement;
    expect(select2.options).toHaveLength(0);
  });

  it('disabled locks it', () => {
    render(<ModelField value="m" models={[{ id: 'm' }]} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('settings.model')).toBeDisabled();
  });
});
