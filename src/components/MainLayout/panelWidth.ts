export const PANEL_MIN_WIDTH = 300;
export const MAIN_CONTENT_MIN = 360;
export const PANEL_DEFAULT_WIDTH = 450;

const STORAGE_KEY = 'panelState.settingsPanelWidth';

/** Widest the panel may be: leaves MainPanel at least MAIN_CONTENT_MIN, floored at MIN. */
export function maxPanelWidth(viewportWidth: number): number {
  return Math.max(PANEL_MIN_WIDTH, viewportWidth - MAIN_CONTENT_MIN);
}

/** Clamp to [MIN, viewport − MAIN_CONTENT_MIN], floored at MIN for tiny viewports. */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  return Math.min(Math.max(width, PANEL_MIN_WIDTH), maxPanelWidth(viewportWidth));
}

export function readPanelWidth(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : PANEL_DEFAULT_WIDTH;
}

export function savePanelWidth(width: number): void {
  localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
}
