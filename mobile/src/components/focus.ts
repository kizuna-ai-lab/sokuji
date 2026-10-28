import { AccessibilityInfo, Platform, type HostInstance } from 'react-native';

/**
 * Puts the screen reader back on `target` once a sheet or menu opened from it
 * has gone (design scope: focus returns to the entry point). The delay lets
 * the overlay finish leaving, or the reader settles on the overlay's remains.
 */
export function refocus(target: React.RefObject<HostInstance | null>) {
  setTimeout(() => {
    if (target.current) AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
  }, Platform.OS === 'ios' ? 350 : 150);
}
