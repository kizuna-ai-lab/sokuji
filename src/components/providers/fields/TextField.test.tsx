import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('../../../utils/openExternalUrl', () => ({ openExternalUrl }));

import { TextField } from './TextField';

beforeEach(() => openExternalUrl.mockClear());

describe('TextField', () => {
  it('a labelled single-line input with its tooltip, writing what is typed', () => {
    const onChange = vi.fn();
    const { container } = render(<TextField id="hot" label="Hot Words Library ID" tooltip="Boost terms." value="lib-1" onChange={onChange} />);
    const field = screen.getByLabelText('Hot Words Library ID') as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    expect(field.type).toBe('text');
    expect(field.id).toBe('hot');
    expect(field.className).toBe('text-input');
    expect(field.value).toBe('lib-1');
    fireEvent.change(field, { target: { value: 'lib-2' } });
    expect(onChange).toHaveBeenCalledWith('lib-2');

    // The tooltip's trigger sits in the label row, and opens on its text.
    const trigger = container.querySelector('.setting-label .tooltip-trigger') as HTMLElement;
    expect(trigger).not.toBeNull();
    act(() => { fireEvent.focus(trigger); });
    const bodies = document.querySelectorAll('.tooltip-body');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].textContent).toBe('Boost terms.');
  });

  it('a link opens its page outside the app, never in place', () => {
    render(<TextField id="hot" label="L" value="" onChange={() => {}} link={{ href: 'https://console.volcengine.com/speech/hotword', label: 'Manage hot words' }} />);
    const link = screen.getByRole('link', { name: 'Manage hot words' });
    expect(link.getAttribute('href')).toBe('https://console.volcengine.com/speech/hotword');
    expect(link.closest('.setting-label .tutorial-link')).not.toBeNull();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith('https://console.volcengine.com/speech/hotword');
  });

  it('draws no tooltip trigger and no link when given none', () => {
    const { container } = render(<TextField id="t" label="L" value="" onChange={() => {}} />);
    expect(container.querySelector('.tooltip-trigger')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('disabled locks it', () => {
    render(<TextField id="t" label="L" value="" onChange={() => {}} disabled />);
    expect(screen.getByLabelText('L')).toBeDisabled();
  });
});
