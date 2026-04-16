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

  const source = item.source ?? 'speaker';
  const mode = source === 'speaker' ? speakerMode : participantMode;

  if (mode === 'both') return true;
  if (mode === 'source') return item.role === 'user';
  if (mode === 'translation') return item.role === 'assistant';
  return true;
}
