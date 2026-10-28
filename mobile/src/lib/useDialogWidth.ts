import { useWindowDimensions } from 'react-native';

/**
 * A dialog's width: the screen less a 16-unit margin each side, at most 512.
 * Set explicitly because the registry's `max-w-[calc(100%-2rem)]` does nothing
 * on native, where a dialog was otherwise as wide as its text (AX5 ran it off
 * the screen).
 */
export function useDialogWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(width - 32, 512);
}
