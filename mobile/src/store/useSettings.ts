import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from 'zustand';
import { createSettingsStore, type SettingsState } from './settings';

// The app's one settings store, on the phone's key-value storage. Kept apart
// from settings.ts so the node tests can import the store without React Native.
export const settingsStore = createSettingsStore(AsyncStorage);

export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}
