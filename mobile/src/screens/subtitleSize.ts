// A subtitle line's size at the system text size, capped. The caller sets
// allowFontScaling={false} and passes this instead of maxFontSizeMultiplier:
// on Android React Native caps the font size at maxFontSizeMultiplier but
// scales a set line height by the full system size, so at the largest sizes a
// capped line stood far taller than its text (TextAttributeProps, RN 0.88).
export function scaledLine(fontSize: number, lineHeight: number, fontScale: number, maxScale: number) {
  const scale = Math.min(fontScale, maxScale);
  return { fontSize: Math.round(fontSize * scale * 10) / 10, lineHeight: Math.round(lineHeight * scale) };
}
