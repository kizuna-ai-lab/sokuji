// src/components/History/format.ts
//
// How History writes sizes, lengths and times on screen.
import { uiLocale } from '../../lib/language/label';

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** A size in KB, MB or GB with one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / KB).toFixed(1)} KB`;
}

/** A length as `H:MM:SS`, or `M:SS` under an hour. */
export function formatLength(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A start date and time in the interface language. */
export function formatDateTime(at: number, language: string | undefined): string {
  return new Intl.DateTimeFormat(uiLocale(language), { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}

/** A date in the interface language. */
export function formatDate(at: number, language: string | undefined): string {
  return new Intl.DateTimeFormat(uiLocale(language), { dateStyle: 'medium' }).format(at);
}
