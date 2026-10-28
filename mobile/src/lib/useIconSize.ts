import { useWindowDimensions } from 'react-native';

// An icon that is a button's only content grows with the system text, up to
// twice its size, so it does not shrink beside large labels (iOS AX5: the
// menu icon stayed 24 units next to text three times its size).
const MAX_SCALE = 2;

export function useIconSize(base: number): number {
  const { fontScale } = useWindowDimensions();
  return Math.round(base * Math.min(Math.max(fontScale, 1), MAX_SCALE));
}
