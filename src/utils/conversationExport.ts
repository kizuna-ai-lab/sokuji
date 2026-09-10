import type { ConversationItem } from '../services/interfaces/IClient';
import type { DisplayMode } from '../stores/settingsStore';
import { Provider } from '../types/Provider';

// Build-time injected by vite.config.ts (define: { __APP_VERSION__ })
declare const __APP_VERSION__: string | undefined;

/** A conversation message after filtering and field extraction. */
export interface NormalizedMessage {
  id: string;
  /** ms since epoch */
  createdAt: number;
  /** Who originated the speech this message relates to. */
  source: 'speaker' | 'participant';
  /** Whether this message is the original spoken text or its translation. */
  kind: 'original' | 'translation';
  /** The displayable text content (from `formatted.transcript` or `formatted.text`, whichever is populated). */
  text: string;
  /** Source language active when this message was produced (snapshotted by MainPanel). May be missing for legacy items. */
  sourceLanguage?: string;
  /** Target language active when this message was produced (snapshotted by MainPanel). May be missing for legacy items. */
  targetLanguage?: string;
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
  /** Canonical session-level source language. Derived from the most recent message; for an empty conversation, falls back to current settings. */
  sourceLanguage: string;
  /** Canonical session-level target language. Derived from the most recent message; for an empty conversation, falls back to current settings. */
  targetLanguage: string;
  /** All distinct source→target pairs that appear across the messages, in first-seen order. Empty when no message carries a snapshot. */
  languagePairs: Array<{ sourceLanguage: string; targetLanguage: string }>;
  /**
   * The scope the user exported under, present ONLY when it left something
   * out. A full export carries no scope field, so "absent" reads as "this is
   * everything" without the reader having to know the mode vocabulary.
   */
  scope?: ExportScope;
}

/** Which lines of each side the export was asked for. */
export interface ExportScope {
  speaker: DisplayMode;
  participant: DisplayMode;
}

/** i18n strings the txt formatter needs (kept as parameter to keep this module React-free). */
export interface TxtI18n {
  speakerYou: string;
  speakerOther: string;
  /** Suffix appended to a speaker label when the row is a translation, e.g. "(trans)". */
  translationSuffix: string;
  headerTitle: string;
  headerGenerated: string;
  headerProvider: string;
  headerModels: string;
  headerSource: string;
  headerTarget: string;
  headerNote: string;
  /** Shown only when the export was narrowed by the scope checkboxes. */
  headerNarrowed: string;
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
  combinedItems: Array<ConversationItem & {
    source?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
  }>
): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const item of combinedItems) {
    if (item.status !== 'completed') continue;
    if (item.type !== 'message') continue;
    if (item.role === 'system') continue;

    // Each item carries the message content in either `transcript` (typical
    // for ASR + local-inference) or `text` (typical for cloud assistants).
    // Pick whichever is non-empty.
    const text = (item.formatted?.transcript || item.formatted?.text || '').trim();
    if (!text) continue;

    const source = item.source === 'participant' ? 'participant' : 'speaker';
    const kind: 'original' | 'translation' =
      item.role === 'assistant' ? 'translation' : 'original';

    out.push({
      id: item.id,
      // Fallback to export-time for items missing createdAt (shouldn't happen
      // for completed items in practice, but producing a 1970-01-01 timestamp
      // would silently make the export look wrong).
      createdAt: item.createdAt ?? Date.now(),
      source,
      kind,
      text,
      sourceLanguage: item.sourceLanguage,
      targetLanguage: item.targetLanguage,
    });
  }
  return out;
}

/**
 * Derive the canonical session-level language pair from the messages
 * themselves, instead of from the live config (which can drift after the
 * session ended). The most recent message with a snapshotted pair wins —
 * this matches what the user most recently translated. Falls back to the
 * caller-supplied pair when no message carries a snapshot (legacy items
 * or empty conversation).
 */
export function deriveSessionLanguagePair(
  messages: NormalizedMessage[],
  fallback: { sourceLanguage: string; targetLanguage: string },
): { sourceLanguage: string; targetLanguage: string } {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.sourceLanguage && m.targetLanguage) {
      return { sourceLanguage: m.sourceLanguage, targetLanguage: m.targetLanguage };
    }
  }
  return fallback;
}

/** Return all distinct source→target pairs that appear in the messages, in first-seen order. */
export function collectLanguagePairs(
  messages: NormalizedMessage[],
): Array<{ sourceLanguage: string; targetLanguage: string }> {
  const seen = new Set<string>();
  const pairs: Array<{ sourceLanguage: string; targetLanguage: string }> = [];
  for (const m of messages) {
    if (!m.sourceLanguage || !m.targetLanguage) continue;
    const key = `${m.sourceLanguage}\u0000${m.targetLanguage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ sourceLanguage: m.sourceLanguage, targetLanguage: m.targetLanguage });
  }
  return pairs;
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
  languagePairs?: Array<{ sourceLanguage: string; targetLanguage: string }>;
  scope?: ExportScope;
}): SessionMetadata {
  const narrowed = args.scope && !(args.scope.speaker === 'both' && args.scope.participant === 'both');
  return {
    exportedAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    provider: args.provider,
    models: args.models,
    sourceLanguage: args.sourceLanguage,
    targetLanguage: args.targetLanguage,
    languagePairs: args.languagePairs ?? [],
    ...(narrowed ? { scope: args.scope } : {}),
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
    // When the conversation contains multiple distinct language pairs (e.g.
    // the user kept the history across two sessions with different language
    // settings), list them all so the header doesn't misrepresent the data.
    const pairs = metadata.languagePairs.length > 0
      ? metadata.languagePairs
      : [{ sourceLanguage: metadata.sourceLanguage, targetLanguage: metadata.targetLanguage }];
    if (pairs.length === 1) {
      lines.push(`${i18n.headerSource}: ${pairs[0].sourceLanguage} ${ARROW} ${i18n.headerTarget}: ${pairs[0].targetLanguage}`);
    } else {
      const pairText = pairs
        .map(p => `${p.sourceLanguage} ${ARROW} ${p.targetLanguage}`)
        .join(', ');
      lines.push(`${i18n.headerSource} ${ARROW} ${i18n.headerTarget}: ${pairText}`);
    }
    lines.push(i18n.headerNote);
    // Only when something was left out — a full export says nothing, so the
    // line's presence is itself the signal.
    if (metadata.scope) {
      lines.push(i18n.headerNarrowed);
    }
    lines.push('');
  }

  // Compute the column width based on the actual localized label set so all
  // four possible labels align consistently.
  const allLabels = [
    `${i18n.speakerYou}:`,
    `${i18n.speakerOther}:`,
    `${i18n.speakerYou} ${i18n.translationSuffix}:`,
    `${i18n.speakerOther} ${i18n.translationSuffix}:`,
  ];
  const maxLabelLen = Math.max(...allLabels.map(s => s.length));
  // +1 ensures at least one trailing space after the colon for all rows.
  const colWidth = Math.max(SPEAKER_COLUMN_WIDTH, maxLabelLen + 1);

  for (const msg of messages) {
    const base = msg.source === 'speaker' ? i18n.speakerYou : i18n.speakerOther;
    const fullLabel = msg.kind === 'translation' ? `${base} ${i18n.translationSuffix}` : base;
    const speakerField = `${fullLabel}:`.padEnd(colWidth, ' ');
    lines.push(`[${formatLocalTime(msg.createdAt)}] ${speakerField}${msg.text}`);
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
      // Present only when at least one message carries a snapshotted pair.
      // Lets readers detect history that spans multiple language pairs.
      ...(metadata.languagePairs.length > 0 ? { languagePairs: metadata.languagePairs } : {}),
      // Present only when the export left something out; absence means the
      // file holds the whole conversation.
      ...(metadata.scope ? { scope: metadata.scope } : {}),
    },
    messageCount: messages.length,
    messages: messages.map(m => ({
      id: m.id,
      timestamp: new Date(m.createdAt).toISOString(),
      source: m.source === 'speaker' ? 'you' : 'other',
      kind: m.kind,
      text: m.text,
      // Per-message language pair snapshot — only included when present so
      // legacy items don't sprout empty fields.
      ...(m.sourceLanguage ? { sourceLanguage: m.sourceLanguage } : {}),
      ...(m.targetLanguage ? { targetLanguage: m.targetLanguage } : {}),
    })),
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

/**
 * Copy a text payload to the system clipboard.
 * Returns true on success, false if both the modern and legacy paths fail.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Derive a short, filesystem-safe title from the conversation, for use in the
 * auto-save filename (e.g. "sokuji-hello-there-20260910-153000.txt" instead
 * of the generic "sokuji-conversation-20260910-153000.txt"). Picks the first
 * *original* (not translated) message so the title reflects what was
 * actually said, not a translation of it.
 *
 * Returns '' when there is no usable text to derive a title from (empty
 * conversation, or the first message is itself empty after trimming) — the
 * caller falls back to the generic filename in that case.
 */
export function deriveAutoSaveTitle(messages: NormalizedMessage[], maxLength = 40): string {
  const first = messages.find(m => m.kind === 'original' && m.text.trim().length > 0);
  const raw = (first?.text ?? '').trim();
  if (!raw) return '';

  const collapsed = raw.replace(/\s+/g, ' ').slice(0, maxLength).trim();
  // Strip characters invalid in Windows/macOS/Linux filenames and drop any
  // trailing dots (Windows treats "name." as "name" but strips it silently —
  // better to never emit it) so the result is safe as a single path segment.
  return collapsed.replace(/[\\/:*?"<>|]/g, '').replace(/\.+$/, '').trim();
}

/**
 * Trigger a file download using a synthetic anchor + blob URL.
 * Works in both Electron renderer and Chrome extension side panel without
 * any extension permissions (uses HTML's standard `download` attribute).
 */
export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
