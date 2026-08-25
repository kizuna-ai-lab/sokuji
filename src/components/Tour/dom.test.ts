import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isVisible, resolveAnchor, waitForAnchor } from './dom';

// jsdom has no layout: getClientRects() is always empty. Stand in for layout
// with an attribute: data-hidden ⇒ no rects, otherwise one rect.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute('data-hidden') ? [] : [{} as DOMRect]) as unknown as DOMRectList;
  });
  document.body.innerHTML = '';
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('isVisible / resolveAnchor', () => {
  it('treats an element with no client rects as absent — that is how <Activity hidden> reports', () => {
    document.body.innerHTML = '<div data-tour="a"></div><div data-tour="b" data-hidden></div>';
    expect(isVisible(document.querySelector('[data-tour="a"]')!)).toBe(true);
    expect(resolveAnchor('a')).not.toBeNull();
    expect(resolveAnchor('b')).toBeNull();
    expect(resolveAnchor('nope')).toBeNull();
  });
});

describe('waitForAnchor', () => {
  it('resolves immediately when the anchor is already visible', async () => {
    document.body.innerHTML = '<div data-tour="a"></div>';
    await expect(waitForAnchor('a', { schedule: () => { throw new Error('should not poll'); } })).resolves.not.toBeNull();
  });

  it('polls until the anchor appears', async () => {
    vi.useFakeTimers();
    const p = waitForAnchor('late', { timeoutMs: 1500, schedule: (cb) => setTimeout(cb, 16), now: () => Date.now() });
    vi.advanceTimersByTime(100);
    document.body.innerHTML = '<div data-tour="late"></div>';
    vi.advanceTimersByTime(20);
    await expect(p).resolves.not.toBeNull();
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    const p = waitForAnchor('never', { timeoutMs: 1500, schedule: (cb) => setTimeout(cb, 16), now: () => Date.now() });
    vi.advanceTimersByTime(1600);
    await expect(p).resolves.toBeNull();
  });
});
