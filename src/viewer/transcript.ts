// src/viewer/transcript.ts
/** The .txt a viewer saves when the host allows it (spec 2026-10-04 §5.4). */
import type { ViewerEntry } from '../lib/share/types';
import { formatLocalDateTime, formatLocalTime } from '../utils/conversationExport';
import type { T } from './strings';
import { piecesOf, piecesText, sidesFor, type Choice } from './text';

export function transcriptText(entries: readonly ViewerEntry[], choice: Choice, t: T, now: number): string {
  const lines = [t('viewer.transcript.header', { time: formatLocalDateTime(now) }), ''];
  for (const entry of entries) {
    const { primary, secondary } = sidesFor(entry, choice.code);
    const first = piecesText(piecesOf(primary, false));
    const second = choice.both ? piecesText(piecesOf(secondary, false)) : '';
    if (first === '' && second === '') continue;
    lines.push(`[${formatLocalTime(entry.t)}]`);
    if (first) lines.push(first);
    if (second) lines.push(second);
    lines.push('');
  }
  return lines.join('\n');
}
