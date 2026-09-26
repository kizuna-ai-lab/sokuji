import type { DisplayMode } from '../../stores/settingsStore';

/**
 * One side's display mode expressed as the two independent lines it shows.
 * The export menu offers these as checkboxes; the toolbar cycles the four
 * modes they add up to.
 */
export interface ScopeToggles {
  /** The original speech line (role='user'). */
  src: boolean;
  /** The translation line (role='assistant'). */
  trans: boolean;
}

/** Split a display mode into its two lines. Inverse of togglesToMode. */
export function modeToToggles(mode: DisplayMode): ScopeToggles {
  return { src: mode === 'both' || mode === 'source', trans: mode === 'both' || mode === 'translation' };
}

/** Fold two lines back into the display mode that shows exactly them. Inverse of modeToToggles. */
export function togglesToMode({ src, trans }: ScopeToggles): DisplayMode {
  if (src && trans) return 'both';
  if (src) return 'source';
  if (trans) return 'translation';
  return 'none';
}
