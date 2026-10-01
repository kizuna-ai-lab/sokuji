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

import type { InstructionsSettings } from '../../../lib/provider/instructions';
import { InstructionsField } from './InstructionsField';

describe('InstructionsField', () => {
  const value: InstructionsSettings = { useTemplateMode: true, systemInstructions: 'mine', participantSystemInstructions: 'theirs' };

  it('is the old System Instructions section: its heading, its tooltip, Quick and Advanced', () => {
    const { container } = render(<InstructionsField value={value} onChange={vi.fn()} preview="PREVIEW" />);
    expect(container.querySelector('#system-instructions-section.system-instructions-section')).not.toBeNull();
    expect(screen.getByText('settings.systemInstructions')).toBeInTheDocument();
    expect(tooltips).toContain('settings.systemInstructionsTooltip');
    const simple = screen.getByRole('button', { name: 'settings.simple' });
    expect(simple.className).toContain('active');
    expect(screen.getByRole('button', { name: 'settings.advanced' })).toBeInTheDocument();
  });

  it('Quick shows the preview behind its toggle, and writes the mode', () => {
    const onChange = vi.fn();
    const { container } = render(<InstructionsField value={value} onChange={onChange} preview="PREVIEW" />);
    expect(screen.queryByText('PREVIEW')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'settings.preview' });
    expect(toggle.className).toContain('preview-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.system-instructions-preview .preview-content')?.textContent).toBe('PREVIEW');
    fireEvent.click(screen.getByRole('button', { name: 'settings.advanced' }));
    expect(onChange).toHaveBeenCalledWith({ useTemplateMode: false });
  });

  it("Advanced edits the user's prompt and Other's, each labelled", () => {
    const onChange = vi.fn();
    render(<InstructionsField value={{ ...value, useTemplateMode: false }} onChange={onChange} preview="PREVIEW" />);

    const mine = screen.getByLabelText('settings.systemInstructions') as HTMLTextAreaElement;
    expect(mine.tagName).toBe('TEXTAREA');
    expect(mine.className).toContain('system-instructions');
    expect(mine.value).toBe('mine');
    expect(mine.placeholder).toBe('settings.enterCustomInstructions');
    fireEvent.change(mine, { target: { value: 'new' } });
    expect(onChange).toHaveBeenCalledWith({ systemInstructions: 'new' });

    const other = screen.getByLabelText("Other's Instructions") as HTMLTextAreaElement;
    expect(other.value).toBe('theirs');
    expect(other.placeholder).toBe('Leave empty to use main instructions');
    fireEvent.change(other, { target: { value: 'changed' } });
    expect(onChange).toHaveBeenCalledWith({ participantSystemInstructions: 'changed' });
    expect(tooltips).toContain("System instructions for translating Other's audio. Leave empty to use main instructions.");

    fireEvent.click(screen.getByRole('button', { name: 'settings.simple' }));
    expect(onChange).toHaveBeenCalledWith({ useTemplateMode: true });
  });

  it('disabled locks the mode and the prompts, not the preview', () => {
    const { rerender } = render(<InstructionsField value={value} onChange={vi.fn()} preview="PREVIEW" disabled />);
    expect(screen.getByRole('button', { name: 'settings.simple' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.advanced' })).toBeDisabled();
    const toggle = screen.getByRole('button', { name: 'settings.preview' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    rerender(<InstructionsField value={{ ...value, useTemplateMode: false }} onChange={vi.fn()} preview="PREVIEW" disabled />);
    expect(screen.getByLabelText('settings.systemInstructions')).toBeDisabled();
    expect(screen.getByLabelText("Other's Instructions")).toBeDisabled();
  });
});
