import { useTurnModeStore } from '../../stores/turnModeStore';
import { isMacOS } from '../../utils/environment';
import { pushKeyLabel } from './pushKey';

/** The push key's name as the keyboard shows it, for every place that tells the user which key to hold. */
export function usePushKeyLabel(): string {
  const code = useTurnModeStore((s) => s.pushKey);
  return pushKeyLabel(code, isMacOS());
}
