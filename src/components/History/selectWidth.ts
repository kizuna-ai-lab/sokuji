// src/components/History/selectWidth.ts
//
// A select at least as wide as its longest choice (owner, 2026-11-17). The app's selects draw their own picker
// (appearance: base-select), whose box is only as wide as the chosen label, so the page measures the labels.

/** The widest label's width plus `chrome` (padding, border and the picker's arrow), rounded up; null when unknown. */
export function selectMinWidth(labels: readonly string[], measure: (label: string) => number, chrome: number): number | null {
  const widest = labels.reduce((max, label) => Math.max(max, measure(label)), 0);
  return widest > 0 ? Math.ceil(widest + chrome) : null;
}

/** What a select draws around its label: its padding and border, and room for the picker's arrow. */
export function selectChrome(style: CSSStyleDeclaration): number {
  const px = (v: string) => parseFloat(v) || 0;
  return px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth) + 24;
}
