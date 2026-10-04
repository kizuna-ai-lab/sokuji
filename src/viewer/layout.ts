// src/viewer/layout.ts
/** Layout by width, text sizes and colour schemes (spec 2026-10-04 §5.3, §5.4). */
export type Layout = 'phone' | 'tablet' | 'desktop';
export const SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type Size = (typeof SIZES)[number];
export const THEMES = ['dark', 'light', 'contrast'] as const;
export type Theme = (typeof THEMES)[number];

export function layoutFor(width: number): Layout {
  if (width < 600) return 'phone';
  return width < 1000 ? 'tablet' : 'desktop';
}

export function defaultSize(layout: Layout): Size {
  return layout === 'phone' ? 'large' : 'medium';
}

export function stepSize(size: Size, delta: 1 | -1): Size {
  const i = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(size) + delta));
  return SIZES[i];
}

/** Within 48px of the bottom counts as following the live edge. */
export function atLiveEdge(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= 48;
}
