import { Platform, type ViewProps } from 'react-native';
import { requireNativeModule, requireNativeView } from 'expo';
import type { ComponentType } from 'react';

export type SwitcherResult = 'system' | 'bluetooth-settings' | 'none';

type AndroidModule = { showOutputSwitcher(): SwitcherResult };

// iOS: the system picker is a view the user taps (no API opens it from code).
export const RoutePickerView: ComponentType<ViewProps & { label?: string; hint?: string }> | null =
  Platform.OS === 'ios' ? requireNativeView('RoutePicker') : null;

// Android: the system's media output panel, opened from code.
export function showOutputSwitcher(): SwitcherResult {
  if (Platform.OS !== 'android') return 'none';
  return requireNativeModule<AndroidModule>('RoutePicker').showOutputSwitcher();
}
