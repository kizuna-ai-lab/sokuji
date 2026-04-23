import type { ConversationItem } from '../services/interfaces/IClient';
import { Provider } from '../types/Provider';

// Build-time injected by vite.config.ts (define: { __APP_VERSION__ })
declare const __APP_VERSION__: string | undefined;

/** A conversation message after filtering and field extraction. */
export interface NormalizedMessage {
  id: string;
  /** ms since epoch */
  createdAt: number;
  source: 'speaker' | 'participant';
  /** From `formatted.transcript`. `null` when missing or empty. */
  originalText: string | null;
  /** From `formatted.text`. `null` when missing or empty. */
  translatedText: string | null;
}

/** Snapshot of session-level metadata captured at export time. */
export interface SessionMetadata {
  /** ISO 8601 UTC */
  exportedAt: string;
  /** From __APP_VERSION__; null if unavailable */
  appVersion: string | null;
  /** Raw provider id (e.g. 'openai', 'local_inference') */
  provider: string;
  /** Variable shape per provider — see getActiveModelInfo */
  models: Record<string, string>;
  sourceLanguage: string;
  targetLanguage: string;
}

/** i18n strings the txt formatter needs (kept as parameter to keep this module React-free). */
export interface TxtI18n {
  speakerYou: string;
  speakerOther: string;
  headerTitle: string;
  headerGenerated: string;
  headerProvider: string;
  headerModels: string;
  headerSource: string;
  headerTarget: string;
  headerNote: string;
  noTranscript: string;
  noTranslation: string;
}

const SPEAKER_COLUMN_WIDTH = 8; // includes trailing colon: "You:    " / "Other:  "
const ARROW = '→'; // →

/** Build "key=value, key=value" or empty string. */
function formatModelsLine(models: Record<string, string>): string {
  const entries = Object.entries(models).filter(([, v]) => v && v.length > 0);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${v}`).join(', ');
}

/** Format ms timestamp as local "YYYY-MM-DD HH:MM:SS". */
function formatLocalDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format ms timestamp as local "HH:MM:SS". */
function formatLocalTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format ms timestamp for use in filename: "YYYYMMDD-HHMMSS" (local time). */
export function formatTimestampForFilename(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Get the `__APP_VERSION__` build constant safely. */
export function getAppVersion(): string | null {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;
  } catch {
    return null;
  }
}
