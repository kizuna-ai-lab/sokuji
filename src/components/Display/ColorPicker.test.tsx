import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import ColorPicker from './ColorPicker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const setup = (value = '#7f3ac1') => {
  const onChange = vi.fn();
  const utils = render(<ColorPicker value={value} onChange={onChange} />);
  const area = utils.container.querySelector('.color-picker__area') as HTMLElement;
  const hue = utils.container.querySelector(
    'input.color-picker__hue',
  ) as HTMLInputElement;
  const hex = utils.container.querySelector(
    'input.color-picker__hex-input',
  ) as HTMLInputElement;
  return { ...utils, onChange, area, hue, hex };
};

// jsdom has no PointerEvent (24.x), so fireEvent.pointerDown would fall back to
// a bare Event and drop clientX/clientY. Dispatch a MouseEvent carrying the
// pointer event's name instead — React picks it up as onPointerDown all the
// same, and the coordinates survive.
const pointer = (type: string, init: MouseEventInit) =>
  new MouseEvent(type, { bubbles: true, ...init });

// jsdom also gives every element a zero-sized rect, which would make the
// pointer -> saturation/brightness math divide by zero. Stamp a real box on.
const stubRect = (el: HTMLElement, box = { left: 0, top: 0, width: 200, height: 100 }) => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  } as DOMRect);
};

describe('ColorPicker', () => {
  it('renders the three controls and seeds them from the current value', () => {
    const { area, hue, hex } = setup('#ff0000');
    expect(area).not.toBeNull();
    expect(hue.value).toBe('0');
    expect(hex.value).toBe('#ff0000');
  });

  it('seeds the hue slider from a non-primary color', () => {
    const { hue } = setup('#0000ff');
    expect(hue.value).toBe('240');
  });

  it('dragging the hue slider emits a new color at the same saturation/brightness', () => {
    const { hue, onChange } = setup('#ff0000');
    fireEvent.change(hue, { target: { value: '120' } });
    expect(onChange).toHaveBeenLastCalledWith('#00ff00');
  });

  it('typing a full 6-digit hex emits exactly that color', () => {
    const { hex, onChange } = setup('#000000');
    fireEvent.change(hex, { target: { value: '#7f3ac1' } });
    expect(onChange).toHaveBeenLastCalledWith('#7f3ac1');
  });

  it('does not emit while the typed hex is still incomplete or invalid', () => {
    const { hex, onChange } = setup('#000000');
    fireEvent.change(hex, { target: { value: '#7f3a' } });
    fireEvent.change(hex, { target: { value: 'zzz' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts 3-digit shorthand on blur', () => {
    const { hex, onChange } = setup('#000000');
    fireEvent.change(hex, { target: { value: '#abc' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(hex);
    expect(onChange).toHaveBeenLastCalledWith('#aabbcc');
  });

  it('restores the current value in the hex field when the user leaves it invalid', () => {
    const { hex } = setup('#123456');
    fireEvent.change(hex, { target: { value: 'nonsense' } });
    fireEvent.blur(hex);
    expect(hex.value).toBe('#123456');
  });

  it('maps a pointer press in the area to saturation (x) and brightness (y)', () => {
    const { area, onChange } = setup('#ff0000');
    stubRect(area);
    // Top-right corner: full saturation, full brightness -> pure hue.
    act(() => { area.dispatchEvent(pointer('pointerdown', { clientX: 200, clientY: 0 })); });
    expect(onChange).toHaveBeenLastCalledWith('#ff0000');
    act(() => { area.dispatchEvent(pointer('pointerup', {})); });

    // Bottom edge: zero brightness -> black regardless of x.
    act(() => { area.dispatchEvent(pointer('pointerdown', { clientX: 120, clientY: 100 })); });
    expect(onChange).toHaveBeenLastCalledWith('#000000');
    act(() => { area.dispatchEvent(pointer('pointerup', {})); });

    // Top-left corner: zero saturation, full brightness -> white.
    act(() => { area.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 })); });
    expect(onChange).toHaveBeenLastCalledWith('#ffffff');
  });

  it('keeps tracking the pointer after it leaves the area, until release', () => {
    const { area, onChange } = setup('#ff0000');
    stubRect(area);
    act(() => { area.dispatchEvent(pointer('pointerdown', { clientX: 200, clientY: 0 })); });
    // Way outside the box on both axes: clamps to the bottom-right corner.
    act(() => {
      window.dispatchEvent(pointer('pointermove', { clientX: 9999, clientY: 9999 }));
    });
    expect(onChange).toHaveBeenLastCalledWith('#000000');

    act(() => { window.dispatchEvent(pointer('pointerup', {})); });
    onChange.mockClear();
    act(() => {
      window.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 0 }));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adjusts saturation and brightness with the arrow keys', () => {
    const { area, onChange } = setup('#ff0000'); // h0 s100 v100
    fireEvent.keyDown(area, { key: 'ArrowLeft' }); // saturation 100 -> 99
    expect(onChange).toHaveBeenLastCalledWith('#ff0303');
    fireEvent.keyDown(area, { key: 'ArrowDown' }); // brightness 100 -> 99
    expect(onChange).toHaveBeenLastCalledWith('#fc0303');
  });

  it('moves in 10-point steps when shift is held', () => {
    const { area, onChange } = setup('#ff0000');
    // saturation 100 -> 90; 0x19 rather than 0x1a because 1 - 0.9 lands just
    // under 0.1 in binary floating point.
    fireEvent.keyDown(area, { key: 'ArrowLeft', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith('#ff1919');
  });

  it('re-syncs when the bound value changes from the outside', () => {
    const { hex, hue, rerender } = setup('#ff0000');
    rerender(<ColorPicker value="#0000ff" onChange={vi.fn()} />);
    expect(hex.value).toBe('#0000ff');
    expect(hue.value).toBe('240');
  });

  it('keeps the chosen hue when the color it emitted comes back as the value', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ColorPicker value="#000000" onChange={onChange} />,
    );
    const hue = container.querySelector('input.color-picker__hue') as HTMLInputElement;
    // Black is black at every hue, so moving the slider re-emits #000000. The
    // echoed value must not snap the slider back to 0.
    fireEvent.change(hue, { target: { value: '270' } });
    expect(onChange).toHaveBeenLastCalledWith('#000000');
    rerender(<ColorPicker value="#000000" onChange={onChange} />);
    expect(
      (container.querySelector('input.color-picker__hue') as HTMLInputElement).value,
    ).toBe('270');
  });
});
