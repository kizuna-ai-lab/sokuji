// src/lib/history/subtitles.ts
//
// Subtitles of a record: SRT and WebVTT from cues. Times are on the record's clock, in milliseconds.

export interface Cue { startMs: number; endMs: number; lines: readonly string[] }

/** A cue lasts at least this long, unless the next one starts sooner. */
export const MIN_CUE_MS = 1000;

interface Settled { startMs: number; endMs: number; lines: string[] }

/** The cues as written: blank lines dropped, a cue with none left skipped, each end settled. */
function settle(cues: readonly Cue[]): Settled[] {
  const kept = cues
    .map((c) => ({ startMs: c.startMs, endMs: c.endMs, lines: c.lines.map((l) => l.trim()).filter((l) => l !== '') }))
    .filter((c) => c.lines.length > 0);
  return kept.map((c, i) => {
    let end = Math.max(c.endMs, c.startMs + MIN_CUE_MS);
    const next = kept[i + 1];
    if (next && next.startMs > c.startMs) end = Math.min(end, Math.max(c.endMs, next.startMs));
    return { ...c, endMs: end };
  });
}

function stamp(ms: number, separator: ',' | '.'): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(t % 1000, 3)}`;
}

export function renderSrt(cues: readonly Cue[]): string {
  return settle(cues)
    .map((c, i) => `${i + 1}\n${stamp(c.startMs, ',')} --> ${stamp(c.endMs, ',')}\n${c.lines.join('\n')}\n\n`)
    .join('');
}

const escapeVtt = (line: string) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/-->/g, '->');

export function renderVtt(cues: readonly Cue[]): string {
  return 'WEBVTT\n\n' + settle(cues)
    .map((c) => `${stamp(c.startMs, '.')} --> ${stamp(c.endMs, '.')}\n${c.lines.map(escapeVtt).join('\n')}\n\n`)
    .join('');
}
