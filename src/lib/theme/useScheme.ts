import { useSyncExternalStore } from 'react';
import { appliedScheme, subscribeScheme, type Scheme } from './theme';

const getSnapshot = (): Scheme => appliedScheme();
const getServerSnapshot = (): Scheme => 'dark';

/**
 * The app's scheme as React state: the value `installTheme` last applied
 * (or the boot script painted), re-rendering on every apply. A surface
 * whose colour the user never set resolves it from this
 * (`useConversationColours`).
 */
export function useScheme(): Scheme {
  return useSyncExternalStore(subscribeScheme, getSnapshot, getServerSnapshot);
}
