// src/lib/history/file/importFile.ts
//
// An audio or video file made into a History record: its length is read first (too long, too large or unreadable
// files are refused before anything is decoded or stored), the audio is decoded a block at a time and compressed into the record's
// recording like any other, the record is named after the file, then the recording is transcribed by the
// recognition stage's service and the record is closed. A failure or a cancel before the recording is stored leaves
// nothing behind; after it, the record keeps its recording without a transcript, to be transcribed later.
import { SAMPLE_RATE } from '../../contract/adapter';
import type { Clock } from '../../contract/clock';
import type { HistoryPort } from '../port';
import type { FileTranscriptionOptions } from '../types';
import { createTrack, type OpusEncoderFactory, type TrackPiece } from '../recording/track';
import type { HostedFileTerms } from './hostedFile';
import type { FileRecognitionService } from './service';
import { transcribeRecord, type TranscribePhase } from './transcribe';

/** Soniox takes a file of up to 300 minutes; decoding a block at a time, length no longer weighs on memory. */
export const MAX_IMPORT_MS = 300 * 60_000;
/** A bound for sanity only: the file is read a range at a time. */
export const MAX_IMPORT_BYTES = 16 * 1000 ** 3;
/** The store takes a track piece of at most 1 MiB. */
const PIECE_BYTES = 1024 * 1024;
/** A sample beyond this is sound (about −54 dBFS); a file with none is silence. */
const LOUD = 64;
const FILE_MODEL = 'stt-async-v6';

/**
 * `HOSTED_TOO_LONG`: longer than Kizuna AI's service takes; `HOSTED_UNAVAILABLE`: its service publishes no terms for a
 * file job (it has none yet); `unchecked`: its terms could not be had (no answer, a refusal), as the panel's block of
 * that name says.
 */
export type ImportCode = 'TOO_LONG' | 'TOO_BIG' | 'UNSUPPORTED' | 'NO_AUDIO' | 'CANCELLED' | 'HOSTED_TOO_LONG' | 'HOSTED_UNAVAILABLE' | 'unchecked';

export class ImportError extends Error {
  readonly code: ImportCode;
  constructor(code: ImportCode, message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

export type ImportPhase = 'reading' | 'decoding' | 'saving' | TranscribePhase;

/** A decoded file: its length, and its audio as 24 kHz mono samples in order. */
export interface DecodedAudio {
  durationMs: number;
  pcm24k(): AsyncIterable<Int16Array>;
}

export interface ImportOptions {
  port: HistoryPort;
  file: File;
  /** The user's language: what the notes are written in. */
  myLanguage: string;
  /** What the transcription is asked for: the languages spoken in the file (the main one first), the translation. */
  options: FileTranscriptionOptions;
  service: FileRecognitionService;
  /** Kizuna AI's terms, for a file transcribed through its service: a file longer than it takes is refused first. */
  hostedTerms?: HostedFileTerms;
  appVersion: string;
  /** The file's length in ms (NaN or Infinity when it cannot be told). */
  readDuration(file: File): Promise<number>;
  decode(file: File, signal?: AbortSignal): Promise<DecodedAudio>;
  encoder: OpusEncoderFactory;
  clock: Clock;
  newId(): string;
  newJobId(): string;
  /** Lets the encoder catch up between chunks. */
  pause?(): Promise<void>;
  onProgress?(p: { phase: ImportPhase }): void;
  signal?: AbortSignal;
}

export type ImportResult = { recordId: string; transcribed: true } | { recordId: string; transcribed: false; failure: string };

const titleOf = (name: string) => name.replace(/\.[^./\\]+$/, '').trim() || name;

export async function importFile(o: ImportOptions): Promise<ImportResult> {
  const pause = o.pause ?? (() => new Promise<void>((resolve) => { setTimeout(resolve, 0); }));
  const progress = (phase: ImportPhase) => o.onProgress?.({ phase });
  const cancelled = () => new ImportError('CANCELLED', 'The import was cancelled');

  progress('reading');
  if (o.file.size > MAX_IMPORT_BYTES) throw new ImportError('TOO_BIG', `The file is larger than ${MAX_IMPORT_BYTES} bytes`);
  let durationMs: number;
  try {
    durationMs = await o.readDuration(o.file);
  } catch {
    throw new ImportError('UNSUPPORTED', 'The file could not be read as audio or video');
  }
  if (!Number.isFinite(durationMs)) throw new ImportError('UNSUPPORTED', 'The length of the file could not be told');
  if (durationMs <= 0) throw new ImportError('NO_AUDIO', 'The file holds no audio');
  // Through Kizuna AI, the service's own limit is the one the user is told of: never the one of Soniox with a key.
  if (o.hostedTerms && durationMs > o.hostedTerms.maxAudioMs) {
    throw new ImportError('HOSTED_TOO_LONG', `The file is longer than ${Math.floor(o.hostedTerms.maxAudioMs / 60_000)} minutes`);
  }
  if (durationMs > MAX_IMPORT_MS) throw new ImportError('TOO_LONG', `The file is longer than ${MAX_IMPORT_MS / 60_000} minutes`);
  if (o.signal?.aborted) throw cancelled();

  progress('decoding');
  let audio: DecodedAudio;
  try {
    audio = await o.decode(o.file, o.signal);
  } catch {
    if (o.signal?.aborted) throw cancelled();
    throw new ImportError('UNSUPPORTED', 'The audio of the file could not be decoded');
  }
  if (o.signal?.aborted) throw cancelled();

  progress('saving');
  const recordId = o.newId();
  const startedAt = Math.round((o.file.lastModified || o.clock.now()) - audio.durationMs);
  await o.port.openRecord({
    id: recordId, startedAt, mode: 'import', myLanguage: o.myLanguage, targetLanguage: o.options.languages[0],
    services: { provider: o.service.service, models: { transcription: FILE_MODEL }, options: o.options }, appVersion: o.appVersion,
  });
  // Closed first (the bin takes closed records only; one with nothing stored is dropped there), then through the bin,
  // as any record is removed: the folder and its files go with the row.
  const remove = async () => {
    try {
      await o.port.closeRecord({ id: recordId, endedAt: startedAt });
      await o.port.binRecords({ ids: [recordId] });
      await o.port.purgeRecords({ ids: [recordId] });
    } catch { /* an open record left behind is closed or dropped by the next launch's recovery */ }
  };
  try {
    await o.port.putLeg({
      recordId, leg: 'participant', languages: { source: o.options.languages[0], target: o.options.translateTo },
      input: null, inputName: null, inputId: null, translated: false, spoken: false,
    });
    const track = createTrack({ startedAt, encoder: o.encoder, serial: 1 });
    const send = async (piece: TrackPiece | null) => {
      if (!piece || piece.bytes.length === 0) return;
      for (let i = 0; i < piece.bytes.length; i += PIECE_BYTES) {
        await o.port.appendTrack({
          recordId, source: 'participant', offsetMs: track.offsetMs ?? 0, durationMs: piece.durationMs, data: piece.bytes.subarray(i, i + PIECE_BYTES),
        });
      }
    };
    let samples = 0;
    let loud = false;
    // Decoding happens a block at a time while the chunks are taken: a file that breaks partway is unreadable.
    const chunks = audio.pcm24k()[Symbol.asyncIterator]();
    try {
      for (;;) {
        let next: IteratorResult<Int16Array>;
        try {
          next = await chunks.next();
        } catch {
          if (o.signal?.aborted) throw cancelled();
          throw new ImportError('UNSUPPORTED', 'The audio of the file could not be decoded');
        }
        if (next.done) break;
        const chunk = next.value;
        if (o.signal?.aborted) throw cancelled();
        if (!loud && chunk.some((v) => v > LOUD || v < -LOUD)) loud = true;
        samples += chunk.length;
        track.pcm(chunk, startedAt + Math.round(samples / (SAMPLE_RATE / 1000)));
        // Decoding outruns Opus: what the encoder has not yet encoded must not pile up (a 3-hour WAV reached 1 GB).
        await track.drain();
        await send(track.take());
        await pause();
      }
    } finally {
      await chunks.return?.();
    }
    if (o.signal?.aborted) throw cancelled();
    await send(await track.end());
    if (!loud) throw new ImportError('NO_AUDIO', 'The file holds only silence');
    if (track.failed) throw new ImportError('UNSUPPORTED', 'The audio could not be compressed');
  } catch (error) {
    await remove();
    throw error;
  }

  await o.port.renameRecord({ id: recordId, title: titleOf(o.file.name) });
  let result: ImportResult;
  try {
    await transcribeRecord({
      port: o.port, recordId, service: o.service, options: o.options, clock: o.clock, newJobId: o.newJobId, signal: o.signal,
      onProgress: (p) => progress(p.phase),
    });
    result = { recordId, transcribed: true };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    result = { recordId, transcribed: false, failure: typeof code === 'string' ? code : 'SERVICE' };
  }
  // The store takes whole milliseconds; a decoder's length has fractions.
  await o.port.closeRecord({ id: recordId, endedAt: startedAt + Math.round(audio.durationMs) });
  return result;
}
