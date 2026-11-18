// electron/file-recognition.js
//
// A kept track of a History record sent to a file recognition service, named by the request (the line-up's
// recognition provider declares it: `Provider.fileRecognition`). One service today, Soniox (`stt-async-v6`); each
// answers in the same word shape: text, start_ms, end_ms, speaker, language. With Soniox the track is uploaded from
// disk, a transcription is made of it, its words come back, and whatever was uploaded is deleted at Soniox in every
// outcome. The host follows the key's region: each region is its own Soniox project with its own keys (see
// src/lib/soniox/regions.ts). The key is used for the calls only; no message, error or log line repeats it.
'use strict';

const fs = require('node:fs');
const { HistoryError } = require('./history-store.js');

const MODEL = 'stt-async-v6';
/** How often a transcription's state is asked for. */
const POLL_MS = 5000;
/** A transcription Soniox is still processing cannot be deleted: asked again this often, this many times. */
const DELETE_RETRY_MS = 5000;
const DELETE_TRIES = 12;
/** A clean-up call (a delete at Soniox) that has not answered by then is given up and logged. */
const CLEANUP_TIMEOUT_MS = 15_000;
/** The regions of src/lib/soniox/regions.ts (a test keeps the two the same). */
const SONIOX_REGIONS = Object.freeze(['us', 'eu', 'jp', 'in']);
const REGIONS = new Set(SONIOX_REGIONS);

/** The REST host of a Soniox region (the US project has no region in its name), as `sonioxHosts(region).api`. */
function sonioxApiHost(region) {
  return region === 'us' ? 'api.soniox.com' : `api.${region}.soniox.com`;
}

const isString = (v) => typeof v === 'string' && v.length > 0;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string';
/** The word list's parts Soniox takes, as the live session sends them. */
const CONTEXT_PARTS = new Set(['terms', 'translation_terms', 'text']);

/**
 * The word list in Soniox's context shape, as the live session sends it: terms, term translations, background text.
 * Anything else is refused rather than sent.
 */
function isSonioxContext(c) {
  if (!isPlainObject(c)) return false;
  if (Object.keys(c).some((k) => !CONTEXT_PARTS.has(k))) return false;
  if (c.terms !== undefined && !(Array.isArray(c.terms) && c.terms.every(isText))) return false;
  if (c.translation_terms !== undefined
    && !(Array.isArray(c.translation_terms) && c.translation_terms.every((t) => isPlainObject(t) && isText(t.source) && isText(t.target)))) return false;
  return c.text === undefined || isText(c.text);
}
const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });

/** Waits `ms`, or rejects as soon as `signal` aborts. */
function waitFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError()); return; }
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

/** What Soniox said about an error, with the key taken out should it ever appear. */
function spoken(text, apiKey) {
  const s = typeof text === 'string' ? text : '';
  return apiKey ? s.split(apiKey).join('[key]') : s;
}

/** A refused call as a HistoryError with the app's code. */
function refusal(status, message, errorType = '') {
  const said = message ? `: ${message}` : '';
  // Soniox decodes an upload as it arrives: one it cannot read is refused there (400 invalid_audio_file).
  if (status === 400 && /invalid_audio/i.test(errorType)) return new HistoryError('BAD_AUDIO', `Soniox could not read the recording (${status})${said}`);
  if (status === 401 || status === 403) return new HistoryError('NO_KEY', `Soniox refused the key (${status})${said}`);
  if (status === 402) return new HistoryError('NO_CREDIT', `Soniox: no credit left (${status})${said}`);
  if (status === 429 && /quota|balance|credit|limit exceeded/i.test(message)) return new HistoryError('NO_CREDIT', `Soniox: no credit left (${status})${said}`);
  if (status === 413) return new HistoryError('TOO_LONG', `Soniox: the recording is too large (${status})${said}`);
  return new HistoryError('SERVICE', `Soniox refused the request (${status})${said}`);
}

/** A transcription Soniox gave up on, by its `error_type`. */
function failedTranscription(errorType, message) {
  const said = `Soniox could not transcribe the recording (${errorType || 'error'})${message ? `: ${message}` : ''}`;
  if (/duration|too_long|length/i.test(errorType || '')) return new HistoryError('TOO_LONG', said);
  if (/audio|decod|format|file/i.test(errorType || '')) return new HistoryError('BAD_AUDIO', said);
  return new HistoryError('SERVICE', said);
}

/**
 * `fetch`, `wait(ms, signal)` and `later(ms)` (the clean-up's pause) are the outside world; `openBlob(path, options)`
 * reads a file from disk as a Blob without loading it all.
 */
function createFileRecognizer({
  fetch = globalThis.fetch, wait = waitFor, later = (ms) => waitFor(ms), openBlob = fs.openAsBlob, logger = console,
  cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
} = {}) {
  /** jobId → { phase, controller } while a recognition runs. */
  const jobs = new Map();
  /** Clean-ups still running after their recognition ended. */
  const cleanups = new Set();

  async function recognize({ store, recordId, service, source, apiKey, region, languageHints = [], translateTo, context, jobId } = {}) {
    if (service !== 'soniox') throw new HistoryError('BAD_INPUT', `No file recognition for ${String(service)}`);
    if (!isString(apiKey) || !REGIONS.has(region) || !isString(jobId) || !Array.isArray(languageHints) || !languageHints.every(isString)) {
      throw new HistoryError('BAD_INPUT', 'A recognition needs a key, a Soniox region, language hints and a job id');
    }
    if ((translateTo !== undefined && !isString(translateTo)) || (context !== undefined && !isSonioxContext(context))) {
      throw new HistoryError('BAD_INPUT', 'A translation needs its language, and a context the word list in Soniox\'s shape');
    }
    if (jobs.has(jobId)) throw new HistoryError('BAD_INPUT', `Job ${jobId} is already running`);
    const file = store.trackFile({ recordId, source });
    if (!file) throw new HistoryError('NO_TRACK', `No kept ${source} track in record ${recordId}`);

    const base = `https://${sonioxApiHost(region)}`;
    const controller = new AbortController();
    const job = { phase: 'uploading', controller };
    jobs.set(jobId, job);
    let fileId = null;
    let transcriptionId = null;

    /**
     * One call; a refusal becomes its HistoryError (with the HTTP status), a cancel CANCELLED, anything else NETWORK.
     * The clean-up's calls pass `cancellable: false`: they must still run after a cancel, and are given up after
     * `cleanupTimeoutMs`.
     */
    async function call(method, path, { json, body, cancellable = true } = {}) {
      const signal = cancellable ? controller.signal : AbortSignal.timeout(cleanupTimeoutMs);
      let response;
      try {
        response = await fetch(`${base}${path}`, {
          method,
          headers: { Authorization: `Bearer ${apiKey}`, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: json !== undefined ? JSON.stringify(json) : body,
          signal,
        });
      } catch (error) {
        if ((cancellable && controller.signal.aborted) || (error && error.name === 'AbortError')) throw new HistoryError('CANCELLED', 'The recognition was cancelled');
        throw new HistoryError('NETWORK', `Soniox could not be reached: ${spoken(error && error.message, apiKey)}`);
      }
      if (!response.ok) {
        let message = '';
        let errorType = '';
        try {
          const answer = await response.json();
          message = spoken(answer && (answer.message || answer.error_message || answer.error), apiKey);
          errorType = String((answer && answer.error_type) || '');
        } catch { /* no body */ }
        throw Object.assign(refusal(response.status, message, errorType), { status: response.status });
      }
      if (response.status === 204) return null;
      return response.json();
    }
    const checkCancelled = () => {
      if (controller.signal.aborted) throw new HistoryError('CANCELLED', 'The recognition was cancelled');
    };

    /** Deletes the transcription, asking again while Soniox is still processing it; one it no longer has is gone. */
    async function deleteTranscription(id) {
      for (let tries = 1; ; tries++) {
        try {
          await call('DELETE', `/v1/transcriptions/${id}`, { cancellable: false });
          return;
        } catch (error) {
          if (error.status === 404) return;
          if (tries >= DELETE_TRIES || error.code !== 'SERVICE') {
            logger.warn(`[Sokuji] [History] Soniox transcription ${id} was not deleted: ${error.message}`);
            return;
          }
          await later(DELETE_RETRY_MS);
        }
      }
    }

    try {
      const blob = await openBlob(file, { type: 'audio/ogg' });
      const form = new FormData();
      form.append('file', blob, `${source}.opus`);
      fileId = (await call('POST', '/v1/files', { body: form })).id;
      checkCancelled();
      job.phase = 'queued';
      transcriptionId = (await call('POST', '/v1/transcriptions', {
        json: {
          model: MODEL, file_id: fileId, enable_speaker_diarization: true, enable_language_identification: true,
          language_hints: languageHints,
          ...(context !== undefined ? { context } : {}),
          // One way: what is already in that language is left as it is.
          ...(translateTo !== undefined ? { translation: { type: 'one_way', target_language: translateTo } } : {}),
          client_reference_id: jobId,
        },
      })).id;
      let state;
      for (;;) {
        checkCancelled();
        try {
          await wait(POLL_MS, controller.signal);
        } catch {
          checkCancelled();
        }
        state = await call('GET', `/v1/transcriptions/${transcriptionId}`);
        checkCancelled();
        if (state.status === 'completed') break;
        if (state.status === 'error') throw failedTranscription(state.error_type, spoken(state.error_message, apiKey));
        job.phase = state.status === 'processing' ? 'processing' : 'queued';
      }
      job.phase = 'fetching';
      const transcript = await call('GET', `/v1/transcriptions/${transcriptionId}/transcript`);
      checkCancelled();
      return { tokens: Array.isArray(transcript && transcript.tokens) ? transcript.tokens : [], audioMs: Number(state.audio_duration_ms) || 0 };
    } finally {
      jobs.delete(jobId);
      if (fileId || transcriptionId) {
        const cleanup = (async () => {
          // The file first: a transcription still processing fails once its file is gone, and can then be deleted.
          if (fileId) {
            try {
              await call('DELETE', `/v1/files/${fileId}`, { cancellable: false });
            } catch (error) {
              logger.warn(`[Sokuji] [History] Soniox file ${fileId} was not deleted: ${error.message}`);
            }
          }
          if (transcriptionId) await deleteTranscription(transcriptionId);
        })();
        cleanups.add(cleanup);
        void cleanup.finally(() => cleanups.delete(cleanup));
        // A cancel answers at once; the clean-up goes on by itself.
        if (!controller.signal.aborted) await cleanup;
      }
    }
  }

  return {
    recognize,
    /** Stops a running recognition; false when there is none by that id. */
    cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job) return false;
      job.controller.abort();
      return true;
    },
    /** The phase of a running recognition, or null. */
    status(jobId) {
      const job = jobs.get(jobId);
      return job ? { phase: job.phase } : null;
    },
    /** Every clean-up still running has finished. */
    settled: () => Promise.all([...cleanups]).then(() => undefined),
  };
}

module.exports = { createFileRecognizer, sonioxApiHost, SONIOX_REGIONS };
