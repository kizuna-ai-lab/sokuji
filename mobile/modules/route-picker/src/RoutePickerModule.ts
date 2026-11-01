import { Platform, type ViewProps } from 'react-native';
import { requireNativeModule, requireNativeView } from 'expo';
import type { ComponentType } from 'react';

export type SwitcherResult = 'system' | 'bluetooth-settings' | 'none';

export type OutputDevice = { id: string; name: string; category: string };

type AndroidModule = {
  showOutputSwitcher(): SwitcherResult;
  currentOutput(): OutputDevice | null;
  addListener(event: 'routeChange', listener: () => void): { remove(): void };
};

// iOS: the system picker is a view the user taps (no API opens it from code).
export const RoutePickerView: ComponentType<ViewProps & { label?: string; hint?: string }> | null =
  Platform.OS === 'ios' ? requireNativeView('RoutePicker') : null;

// Android: the system's media output panel, opened from code.
export function showOutputSwitcher(): SwitcherResult {
  if (Platform.OS !== 'android') return 'none';
  return requireNativeModule<AndroidModule>('RoutePicker').showOutputSwitcher();
}

// Android: the device media plays on, and its changes. The audio library gives
// neither there.
export function currentOutput(): OutputDevice | null {
  return requireNativeModule<AndroidModule>('RoutePicker').currentOutput();
}

export function addOutputListener(listener: () => void): { remove(): void } {
  return requireNativeModule<AndroidModule>('RoutePicker').addListener('routeChange', listener);
}
