// src/lib/history/file/transcribe.ts
//
// A record transcribed (again) from its kept recording: each kept track goes through the file recognition in turn,
// asked for what the user chose (the languages spoken, the language to translate into) with the app's word list; its
// words become sentences on the track's side, each with the translation that began in it (sentences.ts), the tracks'
// sentences are merged by time, and one new transcript holds them. The transcript is made only once every track has its words, so a failure or a cancel leaves the record
// as it was. A new transcript never replaces another (spec: several transcripts per record).
import type { Clock } from '../../contract/clock';
import type { HistoryPort } from '../port';
import type { FileTranscriptionOptions, HistoryRecognizePhase, HistoryRecord, HistorySentenceSide, HistoryTrack, HistoryTrackSource } from '../types';
import type { FileRecognitionService } from './service';
import { EACH_SIDE } from './options';
import { fileSentences, numberSentences, type FileSentence } from './sentences';

/** How often the page asks main for a running recognition's phase. */
export const STATUS_EVERY_MS = 1000;
/** Sentences per write. */
const WRITE_BATCH = 500;

export type TranscribePhase = HistoryRecognizePhase | 'writing';
export type TranscribeCode = 'NO_RECORD' | 'NO_TRACK' | 'NO_SPEECH' | 'CANCELLED' | 'SIGN_IN';

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

/** The tracks a transcription sends, in the record's order: the speaker's and the participant's recordings still kept. */
export function transcribedTracks(record: Pick<HistoryRecord, 'tracks'>): Array<HistoryTrack & { source: HistoryTrackSource }> {
  return record.tracks.filter((t): t is HistoryTrack & { source: HistoryTrackSource } =>
    t.goneAt === null && (t.source === 'speaker' || t.source === 'participant'));
}

type LanguageCodes = Pick<FileRecognitionService, 'languageHint'>;

/**
 * An app language code in the service's own codes: its own, or for a regional code its language's when only that is
 * known; null when the service has neither (the language is then not sent, nor a translation into it).
 */
function serviceLanguage(service: LanguageCodes, code: string): string | null {
  const exact = (c: string) => (service.languageHint ? service.languageHint(c) : c);
  return exact(code) ?? exact(code.split(/[-_]/)[0].toLowerCase());
}

/**
 * What a track is translated into, in the service's code; null when no translation is asked for it: none chosen;
 * "each side into the other's language" for a side the session translated into nothing; a language the service has
 * no code for; or, through Kizuna AI's service, the only language spoken (owner, 2026-11-19). Each side goes into what
 * its own side was translated into in the session. The job sends, and the estimate prices, every track by this one
 * answer.
 */
export function trackTranslation(
  record: Pick<HistoryRecord, 'legs'>, source: HistoryTrackSource, options: FileTranscriptionOptions,
  service: LanguageCodes & { hosted?: true },
): string | null {
  const into = options.translateTo === EACH_SIDE ? record.legs.find((l) => l.leg === source)?.languages.target : options.translateTo;
  const translateTo = into ? serviceLanguage(service, into) : null;
  // The panels always name a language to translate into, an import's own by default. Kizuna AI's service charges a
  // translation: into the only language spoken there is nothing to translate, so it is not asked for, nor paid for.
  // Compared in the service's codes; "automatic" is never translated into, so never matches. The user's own key is
  // asked exactly as chosen.
  const spokenOnly = options.languages.length === 1 ? serviceLanguage(service, options.languages[0]) : null;
  if (service.hosted && translateTo !== null && translateTo === spokenOnly) return null;
  return translateTo;
}

export async function transcribeRecord(o: TranscribeOptions): Promise<{ transcriptId: number; sentences: number }> {
  const cancelled = () => new TranscribeError('CANCELLED', 'The transcription was cancelled');
  const record = await o.port.getRecord(o.recordId);
  if (!record) throw new TranscribeError('NO_RECORD', `No record ${o.recordId}`);
  const tracks = transcribedTracks(record);
  if (tracks.length === 0) throw new TranscribeError('NO_TRACK', `Record ${o.recordId} keeps no recording`);
  const legOf = (source: HistoryTrackSource) => record.legs.find((l) => l.leg === source);
  const speaker = legOf('speaker');
  const participant = legOf('participant');
  // As the live writer decides: two legs on one input may each have heard the other side. An imported file holds
  // everyone on one track, so who is on which side is not known.
  const sideCertain = record.mode !== 'import'
    && !(speaker && participant && speaker.input === participant.input && speaker.inputId === participant.inputId);
  // In the service's own codes; a language it does not know at all is not sent.
  const languageHints = [...new Set(o.options.languages.map((code) => serviceLanguage(o.service, code)).filter((code): code is string => !!code))];
  const askedFor = (source: HistoryTrackSource) => {
    const translateTo = trackTranslation(record, source, o.options, o.service);
    return {
      languageHints,
      ...(translateTo ? { translateTo } : {}),
      ...(o.service.context ? { context: o.service.context } : {}),
    };
  };

  // How a track's call reaches the service. With the user's own key: the key, in its region. Through Kizuna AI's
  // service: the region, the service's address, the sign-in's token as it is when the track starts (so a sign-out
  // between tracks stops the next one), who pays, and the length of the tracks still to come after this one, so the
  // service can tell at the first whether all of them fit.
  const reachFor = async (index: number) => {
    const s = o.service;
    if (!('hosted' in s)) return { apiKey: s.apiKey, ...(s.region ? { region: s.region } : {}) };
    const token = await s.access.token();
    if (!token) {
      // Cancelled while the sign-in was read: the cancel is what happened, not a missing sign-in.
      if (o.signal?.aborted) throw cancelled();
      throw new TranscribeError('SIGN_IN', 'Sign in to Kizuna AI to transcribe with it');
    }
    const laterAudioMs = tracks.slice(index + 1).reduce((sum, t) => sum + t.durationMs, 0);
    return { region: s.region, apiUrl: s.access.apiUrl, token, ...(s.access.payer ? { payer: s.access.payer } : {}), laterAudioMs };
  };

  const lists: FileSentence[][] = [];
  for (const [index, track] of tracks.entries()) {
    if (o.signal?.aborted) throw cancelled();
    const reach = await reachFor(index);
    // Cancelled while the sign-in was read: nothing is sent.
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
        recordId: o.recordId, service: o.service.service, source: track.source, ...reach, ...askedFor(track.source), jobId,
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
