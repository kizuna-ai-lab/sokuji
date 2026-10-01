import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LinesField, LINES_FIELD_MAX } from './LinesField';

describe('LinesField', () => {
  it('a labelled textarea with its tooltip, placeholder and the 4 000-character cap, writing what is typed', () => {
    const onChange = vi.fn();
    const { container } = render(
      <LinesField id="terms" label="Terms" tooltip="Help" placeholder="One per line" value="a" onChange={onChange} />
    );
    const field = screen.getByLabelText('Terms') as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.maxLength).toBe(LINES_FIELD_MAX);
    expect(field.placeholder).toBe('One per line');
    expect(field.value).toBe('a');
    fireEvent.change(field, { target: { value: 'a\nb' } });
    expect(onChange).toHaveBeenCalledWith('a\nb');

    // The tooltip's trigger sits in the label row, and opens on its text.
    const trigger = container.querySelector('.setting-label .tooltip-trigger') as HTMLElement;
    expect(trigger).not.toBeNull();
    act(() => { fireEvent.focus(trigger); });
    const bodies = document.querySelectorAll('.tooltip-body');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].textContent).toBe('Help');
  });

  it('a label without a tooltip draws no tooltip trigger', () => {
    const { container } = render(<LinesField id="terms" label="Terms" placeholder="p" value="" onChange={() => {}} />);
    expect(container.querySelector('.setting-label')).not.toBeNull();
    expect(container.querySelector('.tooltip-trigger')).toBeNull();
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

  // Checked by the typecheck, not at run time: a field always has an
  // accessible name, and a tooltip only has somewhere to sit beside a label.
  it('the props demand an accessible name, and allow a tooltip only with a label', () => {
    const noop = () => {};
    const rejected = [
      // @ts-expect-error neither a label nor an ariaLabel
      <LinesField key="unnamed" id="a" placeholder="p" value="" onChange={noop} />,
      // @ts-expect-error a tooltip with no label row to sit in
      <LinesField key="tooltip" id="b" ariaLabel="B" tooltip="Help" placeholder="p" value="" onChange={noop} />,
      // @ts-expect-error a label and an ariaLabel at once
      <LinesField key="both" id="c" label="C" ariaLabel="C" placeholder="p" value="" onChange={noop} />,
    ];
    expect(rejected).toHaveLength(3);
  });
});
