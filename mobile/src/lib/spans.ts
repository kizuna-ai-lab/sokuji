/**
 * A line's rows with the space before its first word removed. A token from
 * Soniox often begins with a space; joined into one line that is right, but
 * at the line's start it showed as an indent (the desktop's bubbles trim it
 * too). Rows are the projector's: only their text is touched.
 */
export function leadTrimmed<T extends { text: string }>(rows: readonly T[]): T[] {
  const out = [...rows];
  for (let i = 0; i < out.length; i++) {
    const text = out[i].text.trimStart();
    if (text !== out[i].text) out[i] = { ...out[i], text };
    if (text !== '') break;
  }
  return out;
}
