import type { ConversationItem } from '../../services/interfaces/IClient';
import type { DisplayMode } from '../../stores/settingsStore';

/**
 * Returns true if the item should be visible under the current display-mode filters.
 * Error and system items are always shown.
 */
export function shouldShowItem(
  item: ConversationItem,
  speakerMode: DisplayMode,
  participantMode: DisplayMode,
): boolean {
  if (item.type === 'error' || item.role === 'system') return true;
  // Non-message rows (function_call, function_call_output, etc.) aren't
  // source-vs-translation pairs, so they bypass the per-scope filter.
  if (item.type !== 'message') return true;

  const source = item.source ?? 'speaker';
  const mode = source === 'speaker' ? speakerMode : participantMode;

  if (mode === 'both') return true;
  // 'none' hides the whole side. Error and system rows were let through above
  // on purpose: a failure on a hidden side must still be visible somewhere.
  if (mode === 'none') return false;
  if (mode === 'source') return item.role === 'user';
  if (mode === 'translation') return item.role === 'assistant';
  return true;
}

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
