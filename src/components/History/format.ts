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

/** A time of day in the interface language. */
export function formatTime(at: number, language: string | undefined): string {
  return new Intl.DateTimeFormat(uiLocale(language), { timeStyle: 'short' }).format(at);
}

const startOfDay = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** A list's day heading: today, yesterday, or the date with its weekday (and the year when it is not this year). */
export function dayLabel(at: number, now: number, language: string | undefined): string {
  const locale = uiLocale(language);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0 || days === 1) {
    const word = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day');
    return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
  }
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, { weekday: 'short', ...(sameYear ? {} : { year: 'numeric' }), month: 'long', day: 'numeric' }).format(at);
}

/** The key ends an input method composition (choosing a conversion): Enter and Escape belong to it then, not to the page. */
export function isComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}
