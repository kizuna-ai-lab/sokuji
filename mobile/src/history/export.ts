import { createProjector, DEFAULT_PROJECTION } from '@shared/lib/projection/project';
import {
  renderTranscriptJson,
  renderTranscriptTxt,
  type TranscriptHeaderLabels,
  type TranscriptLabels,
  type TranscriptMeta,
} from '@shared/lib/export/transcript';
import type { StoredSession } from './store';

const entriesOf = (s: StoredSession) => createProjector().project([s.leg], DEFAULT_PROJECTION);

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString();
const formatDateTime = (ms: number) => new Date(ms).toLocaleString();

// The desktop's exporters over the stored leg: the same text and JSON a desktop export gives.
export function exportText(s: StoredSession, labels: TranscriptLabels, header: TranscriptHeaderLabels, meta: TranscriptMeta): string {
  return renderTranscriptTxt(entriesOf(s), [s.leg], { labels, formatTime, header: { labels: header, meta, formatDateTime } });
}

export function exportJson(s: StoredSession, meta: TranscriptMeta): string {
  return JSON.stringify(renderTranscriptJson(entriesOf(s), [s.leg], { meta }), null, 2);
}

const pad = (n: number) => n.toString().padStart(2, '0');
export function exportFileName(startedAt: number, kind: 'txt' | 'json'): string {
  const d = new Date(startedAt);
  return `Sokuji-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${kind}`;
}
