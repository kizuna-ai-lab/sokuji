// src/components/SettingsPage/reveal.ts
//
// Bringing a setting into view when another part of the app sends the user to it (owner, 2026-11-18): left where it is
// when it is already wholly in view; otherwise to the middle of the page, or its top when it is taller than the page.

/** The nearest ancestor that scrolls; null: the window. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

export function reveal(element: HTMLElement): void {
  const box = element.getBoundingClientRect();
  const scroller = scrollerOf(element);
  const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  element.scrollIntoView?.({ behavior: 'smooth', block: box.height > view.height ? 'start' : 'center' });
}
