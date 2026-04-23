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

/**
 * Filter and project a combined items array into NormalizedMessage[].
 * Input is the already-merged-and-sorted `combinedItems` from MainPanel
 * (each item carries a `source: 'speaker' | 'participant'` tag).
 */
export function normalizeMessages(
  combinedItems: Array<ConversationItem & { source?: string }>
): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const item of combinedItems) {
    if (item.status !== 'completed') continue;
    if (item.type !== 'message') continue;
    if (item.role === 'system') continue;

    const transcript = item.formatted?.transcript?.trim() || '';
    const text = item.formatted?.text?.trim() || '';
    if (!transcript && !text) continue;

    const source = item.source === 'participant' ? 'participant' : 'speaker';

    out.push({
      id: item.id,
      createdAt: item.createdAt ?? 0,
      source,
      originalText: transcript || null,
      translatedText: text || null,
    });
  }
  return out;
}

/**
 * Extract per-provider model identifiers as a flat object.
 * Empty / unselected fields are omitted (never serialized as "" or null).
 * Caller passes in the already-resolved current-provider settings object
 * (whatever `getCurrentProviderSettings()` returns), plus the provider id,
 * plus the local-inference settings (needed for the LOCAL_INFERENCE branch
 * because its model fields are not in the "current provider settings"
 * returned by the dispatcher — they're separate sub-objects on the store).
 */
export function getActiveModelInfo(
  provider: string,
  currentSettings: any,
  localInferenceSettings: any
): Record<string, string> {
  const result: Record<string, string> = {};

  const put = (key: string, value: any) => {
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  };

  switch (provider) {
    case Provider.OPENAI:
    case Provider.KIZUNA_AI:
    case Provider.OPENAI_COMPATIBLE:
      put('translation', currentSettings?.model);
      put('transcription', currentSettings?.transcriptModel);
      break;
    case Provider.GEMINI:
      put('translation', currentSettings?.model);
      break;
    case Provider.PALABRA_AI:
    case Provider.VOLCENGINE_ST:
    case Provider.VOLCENGINE_AST2:
      // These providers don't expose a user-selectable model on settings;
      // their model name is fixed inside the client code. Leave models empty.
      break;
    case Provider.LOCAL_INFERENCE:
      put('asr', localInferenceSettings?.asrModel);
      put('translation', localInferenceSettings?.translationModel);
      put('tts', localInferenceSettings?.ttsModel);
      break;
    default:
      // Unknown provider — leave models empty rather than guess
      break;
  }

  return result;
}

/**
 * Snapshot the session-level metadata at export time.
 * Caller passes pre-resolved values to keep this module free of store deps.
 */
export function buildSessionMetadata(args: {
  provider: string;
  models: Record<string, string>;
  sourceLanguage: string;
  targetLanguage: string;
}): SessionMetadata {
  return {
    exportedAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    provider: args.provider,
    models: args.models,
    sourceLanguage: args.sourceLanguage,
    targetLanguage: args.targetLanguage,
  };
}

/**
 * Format messages as the plain-text representation defined in the spec.
 *
 * Header (5 or 6 lines depending on whether models is empty), blank line, then
 * one line per message. The clipboard payload uses `includeHeader: false` to
 * skip the header + blank line.
 */
export function formatAsTxt(
  messages: NormalizedMessage[],
  metadata: SessionMetadata,
  i18n: TxtI18n,
  opts: { includeHeader: boolean }
): string {
  const lines: string[] = [];

  if (opts.includeHeader) {
    lines.push(i18n.headerTitle);
    lines.push(`${i18n.headerGenerated}: ${formatLocalDateTime(Date.parse(metadata.exportedAt))}`);
    lines.push(`${i18n.headerProvider}: ${metadata.provider}`);
    const modelsLine = formatModelsLine(metadata.models);
    if (modelsLine.length > 0) {
      lines.push(`${i18n.headerModels}: ${modelsLine}`);
    }
    lines.push(`${i18n.headerSource}: ${metadata.sourceLanguage} ${ARROW} ${i18n.headerTarget}: ${metadata.targetLanguage}`);
    lines.push(`Note: ${i18n.headerNote}.`);
    lines.push('');
  }

  // Speaker label column width: max of the two labels + 1 for the colon, but
  // never less than the spec's recommended 8. Computed dynamically so longer
  // localized labels still align.
  const colWidth = Math.max(
    SPEAKER_COLUMN_WIDTH,
    i18n.speakerYou.length + 1 + 1, // label + ":" + at-least-one-space
    i18n.speakerOther.length + 1 + 1
  );

  for (const msg of messages) {
    const label = msg.source === 'speaker' ? i18n.speakerYou : i18n.speakerOther;
    const speakerField = `${label}:`.padEnd(colWidth, ' ');
    const original = msg.originalText ?? i18n.noTranscript;
    const translated = msg.translatedText ?? i18n.noTranslation;
    lines.push(`[${formatLocalTime(msg.createdAt)}] ${speakerField}${original}  ${ARROW}  ${translated}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Format messages as the JSON representation defined in the spec.
 * Output is pretty-printed with 2-space indent and a trailing newline.
 */
export function formatAsJson(
  messages: NormalizedMessage[],
  metadata: SessionMetadata
): string {
  const payload = {
    exportedAt: metadata.exportedAt,
    appVersion: metadata.appVersion,
    session: {
      provider: metadata.provider,
      models: metadata.models,
      sourceLanguage: metadata.sourceLanguage,
      targetLanguage: metadata.targetLanguage,
      note: 'settings reflect current state at export, not mid-session changes',
    },
    messageCount: messages.length,
    messages: messages.map(m => ({
      id: m.id,
      timestamp: new Date(m.createdAt).toISOString(),
      speaker: m.source === 'speaker' ? 'you' : 'other',
      originalText: m.originalText,
      translatedText: m.translatedText,
    })),
  };
  return JSON.stringify(payload, null, 2) + '\n';
}
