/**
 * Given per-sentence audio segments and the current playback time,
 * return the number of characters that should be highlighted.
 * Falls back to linear interpolation when segments are not available.
 *
 * Uses Math.round so the final character actually gets highlighted at
 * end-of-playback: Math.floor would peg at width-1 because segProgress
 * never quite reaches 1.0 (the player's poll tick before isPlaying flips
 * to false has currentTime slightly under audioEnd).
 */
export function getHighlightedChars(
  currentTime: number,
  segments: Array<{ textEnd: number; audioEnd: number }> | undefined,
  textLength: number,
  progressRatio: number,
): number {
  if (!segments || segments.length === 0) {
    return Math.min(Math.round(textLength * progressRatio), textLength);
  }

  let prevTextEnd = 0;
  let prevAudioEnd = 0;
  for (const seg of segments) {
    if (currentTime < seg.audioEnd) {
      const segDuration = seg.audioEnd - prevAudioEnd;
      const segProgress = segDuration > 0 ? (currentTime - prevAudioEnd) / segDuration : 1;
      const width = seg.textEnd - prevTextEnd;
      return prevTextEnd + Math.min(Math.round(width * segProgress), width);
    }
    prevTextEnd = seg.textEnd;
    prevAudioEnd = seg.audioEnd;
  }
  return prevTextEnd;
}
