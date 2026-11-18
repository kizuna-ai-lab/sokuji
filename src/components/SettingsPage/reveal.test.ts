import { describe, it, expect, vi } from 'vitest';
import { reveal } from './reveal';

/** A scroller 600px tall at the top of the page, and in it an element at `top`, `height` tall. */
function place(top: number, height: number) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollHeight', { value: 3000 });
  Object.defineProperty(scroller, 'clientHeight', { value: 600 });
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 }) as DOMRect;
  const element = document.createElement('section');
  element.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect;
  element.scrollIntoView = vi.fn();
  scroller.appendChild(element);
  document.body.appendChild(scroller);
  return element;
}

// Owner, 2026-11-18: a setting reached from elsewhere (the language pair in the conversation's footer) was scrolled to
// the top of the page, its top edge cut off; it should come to the middle, and not move when it is already in view.
describe('bringing a setting into view', () => {
  it('leaves it where it is when it is already wholly in view', () => {
    const element = place(200, 120);
    reveal(element);
    expect(element.scrollIntoView).not.toHaveBeenCalled();
  });

  it('brings it to the middle when it is out of view, or only partly in it', () => {
    const below = place(900, 120);
    reveal(below);
    expect(below.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    const cut = place(-40, 120);
    reveal(cut);
    expect(cut.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('brings its top into view when it is taller than the scroller', () => {
    const tall = place(900, 800);
    reveal(tall);
    expect(tall.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});
