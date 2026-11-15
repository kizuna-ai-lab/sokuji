// electron/file-recognition.js
//
// A kept track of a History record sent to Soniox's file recognition (`stt-async-v6`): the track is uploaded from
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
const REGIONS = new Set(['us', 'eu', 'jp', 'in']);

/** The REST host of a Soniox region (the US project has no region in its name). */
function sonioxApiHost(region) {
  return region === 'us' ? 'api.soniox.com' : `api.${region}.soniox.com`;
}

const isString = (v) => typeof v === 'string' && v.length > 0;
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
function refusal(status, message) {
  const said = message ? `: ${message}` : '';
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
function createFileRecognizer({ fetch = globalThis.fetch, wait = waitFor, later = (ms) => waitFor(ms), openBlob = fs.openAsBlob, logger = console } = {}) {
  /** jobId → { phase, controller } while a recognition runs. */
  const jobs = new Map();
  /** Clean-ups still running after their recognition ended. */
  const cleanups = new Set();

  async function recognize({ store, recordId, source, apiKey, region, languageHints = [], jobId } = {}) {
    if (!isString(apiKey) || !REGIONS.has(region) || !isString(jobId) || !Array.isArray(languageHints) || !languageHints.every(isString)) {
      throw new HistoryError('BAD_INPUT', 'A recognition needs a key, a Soniox region, language hints and a job id');
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
     * One call; a refusal becomes its HistoryError, a cancel CANCELLED, anything else NETWORK. The clean-up's calls
     * pass `cancellable: false`: they must still run after a cancel.
     */
    async function call(method, path, { json, body, cancellable = true } = {}) {
      const signal = cancellable ? controller.signal : undefined;
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
        try {
          const answer = await response.json();
          message = spoken(answer && (answer.message || answer.error_message || answer.error), apiKey);
        } catch { /* no body */ }
        throw refusal(response.status, message);
      }
      if (response.status === 204) return null;
      return response.json();
    }
    const checkCancelled = () => {
      if (controller.signal.aborted) throw new HistoryError('CANCELLED', 'The recognition was cancelled');
    };

    /** Deletes the transcription, asking again while Soniox is still processing it. */
    async function deleteTranscription(id) {
      for (let tries = 1; ; tries++) {
        try {
          await call('DELETE', `/v1/transcriptions/${id}`, { cancellable: false });
          return;
        } catch (error) {
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
          language_hints: languageHints, client_reference_id: jobId,
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
      // The file first: a transcription still processing fails once its file is gone, and can then be deleted.
      if (fileId) {
        try {
          await call('DELETE', `/v1/files/${fileId}`, { cancellable: false });
        } catch (error) {
          logger.warn(`[Sokuji] [History] Soniox file ${fileId} was not deleted: ${error.message}`);
        }
      }
      if (transcriptionId) {
        const cleanup = deleteTranscription(transcriptionId);
        cleanups.add(cleanup);
        void cleanup.finally(() => cleanups.delete(cleanup));
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

module.exports = { createFileRecognizer, sonioxApiHost };
