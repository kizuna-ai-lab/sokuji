/**
 * Given per-sentence audio segments and the current playback time,
 * return the number of characters that should be highlighted.
 * Falls back to linear interpolation when segments are not available.
 *
 * Lifted from MainPanel.tsx:91-113; identical logic, no behavioural changes.
 */
export function getHighlightedChars(
  currentTime: number,
  segments: Array<{ textEnd: number; audioEnd: number }> | undefined,
  textLength: number,
  progressRatio: number,
): number {
  if (!segments || segments.length === 0) {
    return Math.floor(textLength * progressRatio);
  }

  let prevTextEnd = 0;
  let prevAudioEnd = 0;
  for (const seg of segments) {
    if (currentTime < seg.audioEnd) {
      const segDuration = seg.audioEnd - prevAudioEnd;
      const segProgress = segDuration > 0 ? (currentTime - prevAudioEnd) / segDuration : 1;
      return prevTextEnd + Math.floor((seg.textEnd - prevTextEnd) * segProgress);
    }
    prevTextEnd = seg.textEnd;
    prevAudioEnd = seg.audioEnd;
  }
  return prevTextEnd;
}
