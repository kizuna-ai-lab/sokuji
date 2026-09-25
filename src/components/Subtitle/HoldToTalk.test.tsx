import { describe, it, expect, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { HoldToTalk } from './HoldToTalk';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

/**
 * jsdom has no native `PointerEvent` constructor, so `fireEvent.pointerDown`
 * cannot carry `button`/`pointerType` through its init dict (they are simply
 * dropped by the `Event` fallback). Build the event by hand and define the
 * two properties `HoldToTalk.press` reads.
 */
function pointerDown(node: Element, { pointerType, button }: { pointerType: string; button: number }) {
  const event = createEvent.pointerDown(node, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType, configurable: true });
  Object.defineProperty(event, 'button', { value: button, configurable: true });
  fireEvent(node, event);
}

describe('HoldToTalk', () => {
  it('presses on pointer down and releases on up, leave and cancel — once each', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole('button');
    for (const end of ['pointerUp', 'pointerLeave', 'pointerCancel'] as const) {
      fireEvent.pointerDown(button);
      expect(button.textContent).toBe('Release');
      fireEvent[end](button);
      expect(button.textContent).toBe('Hold');
    }
    fireEvent.pointerUp(button);
    expect(onPress).toHaveBeenCalledTimes(3);
    expect(onRelease).toHaveBeenCalledTimes(3);
  });

  it('releases a held button when it goes away', () => {
    const onRelease = vi.fn();
    const { unmount } = render(<HoldToTalk onPress={() => {}} onRelease={onRelease} />);
    fireEvent.pointerDown(screen.getByRole('button'));
    unmount();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('ignores a non-primary mouse button', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole('button');
    pointerDown(button, { pointerType: 'mouse', button: 2 });
    expect(button.textContent).toBe('Hold');
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.pointerUp(button);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('presses on the primary mouse button, and on a touch/pen pointer with no button semantics', () => {
    const onPress = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={() => {}} />);
    const button = screen.getByRole('button');
    pointerDown(button, { pointerType: 'mouse', button: 0 });
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button);
    pointerDown(button, { pointerType: 'touch', button: 0 });
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('holds on Space while focused', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    button.focus();
    // Auto-repeat: the browser fires keydown again and again while a key stays down.
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: ' ' });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Release');
    fireEvent.keyUp(button, { key: ' ' });
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Hold');
  });

  it('holds on Enter the same way', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole('button');
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(button, { key: 'Enter' });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('takes the key from the button', () => {
    render(<HoldToTalk onPress={() => {}} onRelease={() => {}} />);
    const button = screen.getByRole('button');
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false);
    expect(fireEvent.keyUp(button, { key: ' ' })).toBe(false);
  });

  it('leaves every other key alone', () => {
    const onPress = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={() => {}} />);
    const button = screen.getByRole('button');
    expect(fireEvent.keyDown(button, { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(button, { key: 'Escape' })).toBe(true);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('gives focus back after a keyboard release', () => {
    render(<HoldToTalk onPress={() => {}} onRelease={() => {}} />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    button.focus();
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyUp(button, { key: ' ' });
    expect(document.activeElement).not.toBe(button);
  });

  it('gives focus back after a pointer release', () => {
    render(<HoldToTalk onPress={() => {}} onRelease={() => {}} />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    button.focus();
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    expect(document.activeElement).not.toBe(button);
  });

  it('ends a key hold when the button loses focus', () => {
    const onRelease = vi.fn();
    render(<HoldToTalk onPress={() => {}} onRelease={onRelease} />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    button.focus();
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.blur(button);
    expect(onRelease).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(button, { key: ' ' });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('does not press again from a key while the pointer holds', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(button, { key: ' ' });
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(button, { key: ' ' });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
