/**
 * An export menu's view of one conversation (plan 1d-3): the new writer,
 * with the file header and the metadata of the conversation's own run. The
 * menu draws over this seam; today's conversation builds its own
 * (`ExportButton`) until plan 1e deletes it.
 */
import { formatLocalDateTime, formatLocalTime } from '../../utils/conversationExport';
import type { Leg } from '../conversation/types';
import type { Entry } from '../projection/types';
import type { ConversationInfo } from '../session/conversationSet';
import { showsSide } from '../view/filter';
import {
  renderTranscriptJson,
  renderTranscriptTxt,
  type TranscriptHeaderLabels,
  type TranscriptLabels,
  type TranscriptMeta,
  type TranscriptScope,
} from './transcript';

export interface Exporter {
  /** There is a conversation at all: the button's question, so a narrow scope never locks the menu. */
  readonly hasContent: boolean;
  /** The scope selects something: the actions' question. */
  hasScopedContent(scope: TranscriptScope): boolean;
  /** Plain text: the clipboard's without the header, a file's with it. */
  text(scope: TranscriptScope, withHeader: boolean): string;
  /** A .json file's content. */
  json(scope: TranscriptScope): string;
}

export interface ExportWords {
  labels: TranscriptLabels;
  header: TranscriptHeaderLabels;
}

/** The words an export writes: today's `mainPanel.export.*` keys, plus the two for a missing side. */
export function exportWords(t: (key: string, defaultValue: string) => string): ExportWords {
  return {
    labels: {
      me: t('mainPanel.export.speakerYou', 'Me'),
      other: t('mainPanel.export.speakerOther', 'Other'),
      noTranslation: t('mainPanel.export.noTranslation', '(no translation)'),
      noSource: t('mainPanel.export.noSource', '(no source)'),
    },
    header: {
      title: t('mainPanel.export.headerTitle', 'Sokuji conversation export'),
      generated: t('mainPanel.export.headerGenerated', 'Generated'),
      provider: t('mainPanel.export.headerProvider', 'Provider'),
      models: t('mainPanel.export.headerModels', 'Models'),
      source: t('mainPanel.export.headerSource', 'My Language'),
      target: t('mainPanel.export.headerTarget', "Other's Language"),
      narrowed: t('mainPanel.export.headerNarrowed', 'Note: this export was narrowed at export time — some lines were left out.'),
    },
  };
}

export interface ConversationExportInput {
  entries: readonly Entry[];
  legs: readonly Leg[];
  /** The conversation's run; null before any. */
  info: ConversationInfo | null;
  words: ExportWords;
  appVersion: string | null;
  /** The export's own moment: the header's "Generated" and the JSON's `exportedAt`. */
  now: () => number;
}

/** The run's models under the header's keys; a stage it did not name is left out. */
function modelsOf(info: ConversationInfo | null): Record<string, string> {
  const models: Record<string, string> = {};
  if (info?.models.asrModel) models.asr = info.models.asrModel;
  if (info?.models.translationModel) models.translation = info.models.translationModel;
  if (info?.models.ttsModel) models.tts = info.models.ttsModel;
  return models;
}

const formatTime = (ms: number) => `[${formatLocalTime(ms)}]`;

export function conversationExporter({ entries, legs, info, words, appVersion, now }: ConversationExportInput): Exporter {
  const meta = (): TranscriptMeta => ({ exportedAt: now(), appVersion, provider: info?.provider ?? null, models: modelsOf(info) });
  return {
    // Answered from the entries' rows, not a render: an exchange always has
    // rows (the projector drops exchanges with none, and `sideOf` returns
    // null exactly for no rows), so a row on a scoped-in side is enough
    // (plan 1d-3 review, Minor 2).
    hasContent: entries.some((e) => e.kind === 'exchange'),
    hasScopedContent: (scope) => entries.some((e) =>
      e.kind === 'exchange'
      && ((showsSide(scope[e.leg], 'source') && e.source.length > 0)
        || (showsSide(scope[e.leg], 'translation') && e.translation.length > 0))),
    text: (scope, withHeader) => renderTranscriptTxt(entries, legs, {
      labels: words.labels,
      formatTime,
      scope,
      ...(withHeader ? { header: { labels: words.header, meta: meta(), formatDateTime: formatLocalDateTime } } : {}),
    }),
    // `format` first, so a reader of the file knows its schema before its
    // groups (plan 1d-3 review, Minor 3); this is the only JSON schema after
    // plan 1e.
    json: (scope) => `${JSON.stringify({ format: 'sokuji-conversation/2', ...renderTranscriptJson(entries, legs, { scope, meta: meta() }) }, null, 2)}\n`,
  };
}
