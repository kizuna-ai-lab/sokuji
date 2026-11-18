// src/lib/history/file/transcribe.ts
//
// A record transcribed (again) from its kept recording: each kept track goes through the file recognition in turn,
// asked for what the user chose (the languages spoken, the language to translate into) with the app's word list; its
// words become sentences on the track's side, each with the translation that began in it (sentences.ts), the tracks'
// sentences are merged by time, and one new transcript holds them. The transcript is made only once every track has its words, so a failure or a cancel leaves the record
// as it was. A new transcript never replaces another (spec: several transcripts per record).
import type { Clock } from '../../contract/clock';
import type { HistoryPort } from '../port';
import type { FileTranscriptionOptions, HistoryRecognizePhase, HistorySentenceSide, HistoryTrackSource } from '../types';
import type { FileRecognitionService } from './service';
import { EACH_SIDE } from './options';
import { fileSentences, numberSentences, type FileSentence } from './sentences';

/** How often the page asks main for a running recognition's phase. */
export const STATUS_EVERY_MS = 1000;
/** Sentences per write. */
const WRITE_BATCH = 500;

export type TranscribePhase = HistoryRecognizePhase | 'writing';
export type TranscribeCode = 'NO_RECORD' | 'NO_TRACK' | 'NO_SPEECH' | 'CANCELLED';

export class TranscribeError extends Error {
  readonly code: TranscribeCode;
  constructor(code: TranscribeCode, message: string) {
    super(message);
    this.name = 'TranscribeError';
    this.code = code;
  }
}

export interface TranscribeOptions {
  port: HistoryPort;
  recordId: string;
  service: FileRecognitionService;
  options: FileTranscriptionOptions;
  clock: Clock;
  newJobId: () => string;
  onProgress?(p: { phase: TranscribePhase; track?: HistoryTrackSource }): void;
  signal?: AbortSignal;
}

const SIDE_OF: Record<HistoryTrackSource, HistorySentenceSide> = { speaker: 'mine', participant: 'other' };

export async function transcribeRecord(o: TranscribeOptions): Promise<{ transcriptId: number; sentences: number }> {
  const cancelled = () => new TranscribeError('CANCELLED', 'The transcription was cancelled');
  const record = await o.port.getRecord(o.recordId);
  if (!record) throw new TranscribeError('NO_RECORD', `No record ${o.recordId}`);
  const tracks = record.tracks.filter((t): t is typeof t & { source: HistoryTrackSource } =>
    t.goneAt === null && (t.source === 'speaker' || t.source === 'participant'));
  if (tracks.length === 0) throw new TranscribeError('NO_TRACK', `Record ${o.recordId} keeps no recording`);
  const legOf = (source: HistoryTrackSource) => record.legs.find((l) => l.leg === source);
  const speaker = legOf('speaker');
  const participant = legOf('participant');
  // As the live writer decides: two legs on one input may each have heard the other side. An imported file holds
  // everyone on one track, so who is on which side is not known.
  const sideCertain = record.mode !== 'import'
    && !(speaker && participant && speaker.input === participant.input && speaker.inputId === participant.inputId);
  // In the service's own codes, a regional code as its language when only that is known; a language it does not know
  // at all is not sent, nor a translation into one.
  const exact = (code: string) => (o.service.languageHint ? o.service.languageHint(code) : code);
  const wire = (code: string) => exact(code) ?? exact(code.split(/[-_]/)[0].toLowerCase());
  const languageHints = [...new Set(o.options.languages.map(wire).filter((code): code is string => !!code))];
  // Each side into the other's language: every track into what its own side was translated into in the session.
  const translateToFor = (source: HistoryTrackSource) => {
    const into = o.options.translateTo === EACH_SIDE ? legOf(source)?.languages.target : o.options.translateTo;
    return into ? wire(into) : null;
  };
  const askedFor = (source: HistoryTrackSource) => {
    const translateTo = translateToFor(source);
    return {
      languageHints,
      ...(translateTo ? { translateTo } : {}),
      ...(o.service.context ? { context: o.service.context } : {}),
    };
  };

  const lists: FileSentence[][] = [];
  for (const track of tracks) {
    if (o.signal?.aborted) throw cancelled();
    const jobId = o.newJobId();
    o.onProgress?.({ phase: 'uploading', track: track.source });
    let done = false;
    let cancelPoll: (() => void) | null = null;
    const poll = () => {
      cancelPoll = o.clock.setTimeout(() => {
        void o.port.recognitionStatus({ jobId }).then((s) => {
          if (!done && s) o.onProgress?.({ phase: s.phase, track: track.source });
        }, () => {});
        if (!done) poll();
      }, STATUS_EVERY_MS);
    };
    poll();
    const onAbort = () => { void o.port.cancelRecognition({ jobId }).catch(() => false); };
    o.signal?.addEventListener('abort', onAbort, { once: true });
    let tokens;
    try {
      ({ tokens } = await o.port.recognize({
        recordId: o.recordId, service: o.service.service, source: track.source, apiKey: o.service.apiKey,
        ...(o.service.region ? { region: o.service.region } : {}), ...askedFor(track.source), jobId,
      }));
    } catch (error) {
      if (o.signal?.aborted) {
        void o.port.cancelRecognition({ jobId }).catch(() => false);
        throw cancelled();
      }
      throw error;
    } finally {
      done = true;
      (cancelPoll as (() => void) | null)?.();
      o.signal?.removeEventListener('abort', onAbort);
    }
    if (o.signal?.aborted) throw cancelled();
    const leg = legOf(track.source);
    lists.push(fileSentences(tokens, {
      side: SIDE_OF[track.source], sideCertain, track: leg?.input === 'microphone' ? 'microphone' : 'other',
      offsetMs: track.offsetMs, idPrefix: `file-${track.source}`, language: leg?.languages.source,
    }));
  }

  const sentences = numberSentences(lists);
  if (sentences.length === 0) throw new TranscribeError('NO_SPEECH', 'No speech was recognized in the recording');
  if (o.signal?.aborted) throw cancelled();
  o.onProgress?.({ phase: 'writing' });
  const transcriptId = await o.port.createTranscript({
    recordId: o.recordId, origin: { service: o.service.service, kind: 'file', options: o.options }, textKind: 'original',
  });
  try {
    for (let i = 0; i < sentences.length; i += WRITE_BATCH) {
      await o.port.appendSentences({ transcriptId, sentences: sentences.slice(i, i + WRITE_BATCH) });
    }
  } catch (error) {
    // A version with half its sentences is not kept: it goes, by its own id (never the record's other versions). The
    // write's failure is what the user is told, even when this clean-up fails too.
    await o.port.deleteTranscript({ transcriptId }).catch(() => {});
    throw error;
  }
  return { transcriptId, sentences: sentences.length };
}
