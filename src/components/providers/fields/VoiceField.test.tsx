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

import { VoiceField } from './VoiceField';

describe('VoiceField', () => {
  const options = [
    { value: 'Aoede', name: 'Aoede' },
    { value: 'Puck', name: 'Puck' },
  ];

  it('is the old voice section: a labelled select over the options, writing the choice', () => {
    const onChange = vi.fn();
    const { container } = render(<VoiceField value="Puck" options={options} onChange={onChange} />);
    expect(container.querySelector('#voice-settings-section.voice-settings-section')).not.toBeNull();
    const select = screen.getByLabelText('settings.voice') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.className).toContain('select-dropdown');
    expect(select.value).toBe('Puck');
    expect(select.options).toHaveLength(2);
    fireEvent.change(select, { target: { value: 'Aoede' } });
    expect(onChange).toHaveBeenCalledWith('Aoede');
    expect(tooltips).toContain('settings.voiceTooltip');
  });

  it("with the other party spoken, two labelled selects named by who hears them, and a note when a run swaps the other's", () => {
    const onChange = vi.fn();
    const theirs = vi.fn();
    const { rerender } = render(<VoiceField value="Aoede" options={options} onChange={onChange} participant={{ value: 'Puck', effective: 'Puck', onChange: theirs }} />);
    expect(screen.queryByLabelText('settings.voice')).toBeNull();
    expect((screen.getByLabelText('Voice the other side hears') as HTMLSelectElement).value).toBe('Aoede');
    const theirSelect = screen.getByLabelText('Voice I hear') as HTMLSelectElement;
    expect(theirSelect.value).toBe('Puck');
    expect(theirSelect.className).toContain('select-dropdown');
    fireEvent.change(theirSelect, { target: { value: 'Aoede' } });
    expect(theirs).toHaveBeenCalledWith('Aoede');
    expect(screen.queryByText(/Same as the voice the other side hears/)).toBeNull();

    rerender(<VoiceField value="Aoede" options={options} onChange={onChange} participant={{ value: 'Aoede', effective: 'Puck', onChange: theirs }} />);
    expect(screen.getByText('Same as the voice the other side hears, so Puck reads instead.')).toBeInTheDocument();
  });

  it('disabled disables it', () => {
    render(<VoiceField value="Aoede" options={options} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('settings.voice')).toBeDisabled();
  });
});
