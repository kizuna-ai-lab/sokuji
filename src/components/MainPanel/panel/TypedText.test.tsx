import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TypedText from './TypedText';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TypedText', () => {
  it('trims on Enter, sends and empties the box', () => {
    const onSend = vi.fn();
    render(<TypedText onSend={onSend} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  hello ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');
  });

  it('does nothing on Enter with a blank box', () => {
    const onSend = vi.fn();
    render(<TypedText onSend={onSend} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables the send button while blank, and sends on click once text exists', () => {
    const onSend = vi.fn();
    render(<TypedText onSend={onSend} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    const button = screen.getByTitle('mainPanel.send');
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: 'hi' } });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith('hi');
    expect(input.value).toBe('');
  });

  it('ignores a second send within 300ms, and allows it after the cooldown', () => {
    const onSend = vi.fn();
    render(<TypedText onSend={onSend} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    const button = screen.getByTitle('mainPanel.send');

    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');

    // Typed again immediately: the 300ms latch, not the blank box, is what
    // blocks this second attempt.
    fireEvent.change(input, { target: { value: 'second' } });
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('second');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith('second');
    expect(input.value).toBe('');
  });
});
