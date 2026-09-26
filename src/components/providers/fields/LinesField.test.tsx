import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinesField, LINES_FIELD_MAX } from './LinesField';

describe('LinesField', () => {
  it('a labelled textarea with its tooltip, placeholder and the 4 000-character cap, writing what is typed', () => {
    const onChange = vi.fn();
    render(
      <LinesField id="terms" label="Terms" tooltip="Help" placeholder="One per line" value="a" onChange={onChange} />
    );
    const field = screen.getByLabelText('Terms') as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.maxLength).toBe(LINES_FIELD_MAX);
    expect(field.placeholder).toBe('One per line');
    expect(field.value).toBe('a');
    fireEvent.change(field, { target: { value: 'a\nb' } });
    expect(onChange).toHaveBeenCalledWith('a\nb');
  });

  it('without a label it is named by ariaLabel, and draws no label row', () => {
    const { container } = render(
      <LinesField id="bg" ariaLabel="Background" placeholder="p" value="" onChange={() => {}} />
    );
    expect(screen.getByLabelText('Background')).toBeInTheDocument();
    expect(container.querySelector('.setting-label')).toBeNull();
  });

  it('disabled locks it', () => {
    render(<LinesField id="terms" label="Terms" placeholder="p" value="" onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Terms')).toBeDisabled();
  });
});
