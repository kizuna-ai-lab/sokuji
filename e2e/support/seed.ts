import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO } from './app';

interface Store {
  openRecord(o: unknown): void;
  createTranscript(o: unknown): number;
  appendSentences(o: unknown): void;
  closeRecord(o: unknown): void;
  close(): void;
}

export interface SeedSentence {
  /** 'mine' is the microphone's side, 'other' the other side's. */
  side: 'mine' | 'other';
  text: string;
  startMs: number;
  endMs: number;
  /** Sentences of one side with the same segment show in one row of the record page. */
  segmentId?: string;
}

export interface SeedRecord {
  id: string;
  startedAt: number;
  durationMs: number;
  myLanguage?: string;
  targetLanguage?: string;
  sentences: SeedSentence[];
}

/** `count` sentences, one every `everyMs`, alternating sides: a meeting long enough for notes without a session to wait through. */
export function meeting(count: number, everyMs = 10_000): SeedSentence[] {
  return Array.from({ length: count }, (_, i) => ({
    side: i % 2 === 0 ? 'mine' as const : 'other' as const,
    text: `Sentence ${i + 1} of the seeded meeting.`,
    startMs: i * everyMs,
    endMs: i * everyMs + everyMs - 1_000,
  }));
}

/**
 * Writes closed records into a user-data directory's History with the app's own store (electron/history-store.js),
 * so the file has whatever shape the app's current schema gives it. Call it before `launchApp({ userData })`: the app
 * owns the file while it runs. The records have a transcript and no recording.
 */
export function seedHistory(userData: string, records: SeedRecord[]): void {
  const nodeRequire = createRequire(__filename);
  const { openHistory } = nodeRequire(path.join(REPO, 'electron/history-store.js')) as { openHistory(o: { dir: string }): Store };
  const store = openHistory({ dir: path.join(userData, 'history') });
  try {
    for (const record of records) {
      store.openRecord({
        id: record.id, startedAt: record.startedAt, mode: 'both', myLanguage: record.myLanguage ?? 'en', targetLanguage: record.targetLanguage ?? 'ja',
        services: { provider: 'fake', models: {} }, appVersion: '0.0.0-e2e',
      });
      const transcriptId = store.createTranscript({ recordId: record.id, origin: { service: 'fake', kind: 'live' } });
      store.appendSentences({
        transcriptId,
        sentences: record.sentences.map((s, i) => ({
          n: i + 1, side: s.side, sideCertain: true, track: s.side === 'mine' ? 'microphone' : 'other', speaker: '1',
          startMs: s.startMs, endMs: s.endMs, text: s.text, timeKind: 'given', ...(s.segmentId ? { segmentId: s.segmentId } : {}),
        })),
      });
      store.closeRecord({ id: record.id, endedAt: record.startedAt + record.durationMs });
    }
  } finally {
    store.close();
  }
}
