// electron/file-recognition.js
//
// A kept track of a History record sent to a file recognition service, named by the request (the line-up's
// recognition provider declares it: `Provider.fileRecognition`). One service today, Soniox (`stt-async-v6`); each
// answers in the same word shape: text, start_ms, end_ms, speaker, language. With Soniox the track is uploaded from
// disk, a transcription is made of it, its words come back, and whatever was uploaded is deleted at Soniox in every
// outcome. The host follows the key's region: each region is its own Soniox project with its own keys (see
// src/lib/soniox/regions.ts). The key is used for the calls only; no message, error or log line repeats it.
//
// Kizuna AI's Soniox (`kizunaai_soniox`) reaches the same Soniox through the Kizuna AI service, as a file job of the
// signed-in account: the track is uploaded to the service, transcribed there, its words (Soniox's) come back, and the
// job is ended at the service in every outcome once it has an id. The sign-in token is used for that job's calls only,
// sent only over https (over http only to this computer, for development), and no message, error or log line repeats
// it.
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
/** Ending a file job at the Kizuna AI service is asked again this many times after a network failure or a 5xx. */
const END_RETRIES = 3;
/** A file job's state not had (a network failure or a 5xx) is asked again at the next poll, this many times in a row. */
const POLL_RETRIES = 3;
/** A file job polled this long without finishing is given up as the service's failure (and ended there). */
const HOSTED_MAX_WAIT_MS = 60 * 60_000;
/** The hosts the sign-in token may be sent to over plain http: this computer, for development. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Whose balance pays a file job at the Kizuna AI service; absent, the service's own choice. */
const PAYERS = new Set(['organization', 'personal']);

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
 * The Kizuna AI service's address as the calls are made below it, without its trailing slash; null for one the sign-in
 * token must not be sent to: not https (http only to this computer, for development), or carrying a query or a
 * fragment, which would ride along with every call.
 */
function serviceAddress(v) {
  if (!isString(v) || /[?#]/.test(v)) return null;
  let url;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return null;
  return v.replace(/\/+$/, '');
}

/**
 * A refusal of the Kizuna AI service as a HistoryError with the app's code, read from the status and the answer's
 * `code`, `reason` and `subject`. The answer's own `error` text is not repeated: the code says what happened. A 404
 * to the start call is a service that has no file jobs for this account (or none at all).
 */
function hostedRefusal(status, answer, { starting, payer, token }) {
  const code = answer && typeof answer.code === 'string' ? answer.code : '';
  const as = (appCode, what) => new HistoryError(appCode, `The Kizuna AI service ${what} (${status}${code ? ` ${spoken(code, token)}` : ''})`);
  if (status === 401) return as('SIGN_IN', 'asks to sign in again');
  if (status === 402) {
    if (answer && answer.reason === 'org_balance_held') return as('ORG_BALANCE_HELD', 'holds the organization\'s balance');
    return as(payer === 'organization' ? 'ORG_NO_BALANCE' : 'NO_BALANCE', 'found no balance left');
  }
  // A frozen wallet only when the service says so: any other 403 (another code, none, a proxy's page) is its failure.
  if (status === 403 && code === 'not_org_member') return as('NOT_ORG_MEMBER', 'found the account no longer in the organization');
  if (status === 403 && code === 'wallet_frozen') {
    return as(answer.subject === 'organization' ? 'ORG_WALLET_FROZEN' : 'WALLET_FROZEN', 'found the wallet frozen');
  }
  if (status === 404 && starting) return as('HOSTED_UNAVAILABLE', 'has no file transcription for this account');
  if (status === 409 && code === 'file_job_running') return as('JOB_RUNNING', 'is already running a file job of this account');
  if (status === 413 && code === 'too_long') return as('HOSTED_TOO_LONG', 'takes no recording this long');
  if (status === 422 && code === 'bad_audio') return as('BAD_AUDIO', 'could not read the recording');
  return as('SERVICE', 'refused the request');
}

/** A file job the Kizuna AI service gave up on, by Soniox's `error_type`: too long, the audio's fault, or the service's. */
function failedFileJob(errorType, token) {
  const said = `Kizuna AI's Soniox could not transcribe the recording (${spoken(errorType, token) || 'error'})`;
  // The length first: a type such as `audio_duration_exceeded` names the audio too.
  if (/duration|too_long|length/i.test(errorType)) return new HistoryError('HOSTED_TOO_LONG', said);
  return new HistoryError(/audio|decod|format|file/i.test(errorType) ? 'BAD_AUDIO' : 'SERVICE', said);
}

/**
 * `fetch`, `wait(ms, signal)`, `later(ms)` (the clean-up's pause) and `now()` (the clock a file job's polling is timed
 * by) are the outside world; `hostedMaxWaitMs` is how long a file job's transcription is waited for; `openBlob(path, options)` reads a file from disk as a Blob without loading it all.
 */
function createFileRecognizer({
  fetch = globalThis.fetch, wait = waitFor, later = (ms) => waitFor(ms), now = Date.now, openBlob = fs.openAsBlob, logger = console,
  cleanupTimeoutMs = CLEANUP_TIMEOUT_MS, hostedMaxWaitMs = HOSTED_MAX_WAIT_MS,
} = {}) {
  /** jobId → { phase, controller } while a recognition runs. */
  const jobs = new Map();
  /** Clean-ups still running after their recognition ended. */
  const cleanups = new Set();

  /** The service the request names: Soniox with the user's own key, or Kizuna AI's Soniox through the Kizuna AI service. */
  async function recognize(request = {}) {
    if (request.service === 'soniox') return recognizeWithSonioxKey(request);
    if (request.service === 'kizunaai_soniox') return recognizeThroughKizuna(request);
    throw new HistoryError('BAD_INPUT', `No file recognition for ${String(request.service)}`);
  }

  async function recognizeWithSonioxKey({ store, recordId, source, apiKey, region, languageHints = [], translateTo, context, jobId }) {
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

  /**
   * The track as a file job of the signed-in account at the Kizuna AI service (`apiUrl`), which runs it at Soniox in
   * `region` and charges `payer`. The track's length is the store's, never the page's; `laterAudioMs` is the length of
   * the record's tracks still to come after this one, so the service can tell at the first whether all of them fit.
   */
  async function recognizeThroughKizuna({
    store, recordId, source, apiUrl, token, region, payer, laterAudioMs = 0, languageHints = [], translateTo, context, jobId,
  }) {
    const address = serviceAddress(apiUrl);
    if (!address || !isString(token) || !REGIONS.has(region) || !isString(jobId) || !Array.isArray(languageHints) || !languageHints.every(isString)) {
      throw new HistoryError('BAD_INPUT', 'A recognition through Kizuna AI needs the service\'s https address (http only on this computer) without a query, a sign-in, a Soniox region, language hints and a job id');
    }
    if (!Number.isInteger(laterAudioMs) || laterAudioMs < 0 || (payer !== undefined && !PAYERS.has(payer))) {
      throw new HistoryError('BAD_INPUT', 'The audio still to come is a whole number of milliseconds, and the payer the organization or the person');
    }
    if ((translateTo !== undefined && !isString(translateTo)) || (context !== undefined && !isSonioxContext(context))) {
      throw new HistoryError('BAD_INPUT', 'A translation needs its language, and a context the word list in Soniox\'s shape');
    }
    if (jobs.has(jobId)) throw new HistoryError('BAD_INPUT', `Job ${jobId} is already running`);
    const file = store.trackFile({ recordId, source });
    const record = file ? store.getRecord(recordId) : null;
    const track = record ? record.tracks.find((t) => t.source === source && t.goneAt === null) : null;
    if (!file || !track) throw new HistoryError('NO_TRACK', `No kept ${source} track in record ${recordId}`);

    const base = `${address}/soniox/file-jobs`;
    const controller = new AbortController();
    const job = { phase: 'uploading', controller };
    jobs.set(jobId, job);
    /** The service's id of the job, once it has named it: from then on the job is ended in every outcome. */
    let fileJobId = null;

    /**
     * One call; a refusal becomes its HistoryError (with the HTTP status), a cancel CANCELLED, anything else NETWORK.
     * `starting` marks the start call, whose 404 means the service has no file jobs. The end passes
     * `cancellable: false`: it must still run after a cancel, and is given up after `cleanupTimeoutMs`. `withinMs`
     * (a poll's) is what is left of the wait for the transcription: the call, and the reading of its answer, are given
     * up then, so an answer that never ends cannot hold the job past the wait.
     */
    async function call(method, path, { json, blob, starting = false, cancellable = true, withinMs } = {}) {
      const limit = cancellable && withinMs !== undefined ? AbortSignal.timeout(withinMs) : null;
      let signal = cancellable ? controller.signal : AbortSignal.timeout(cleanupTimeoutMs);
      if (limit) signal = AbortSignal.any([controller.signal, limit]);
      /** The wait ran out during this call (and the user did not cancel): the service's failure, not a cancel. */
      const overdue = () => limit !== null && limit.aborted && !controller.signal.aborted;
      let contentType = null;
      if (json !== undefined) contentType = 'application/json';
      else if (blob !== undefined) contentType = 'audio/ogg';
      let response;
      try {
        response = await fetch(`${base}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
          // A Blob of known size: fetch sends its Content-Length, which the service checks against the length.
          body: json !== undefined ? JSON.stringify(json) : blob,
          signal,
        });
      } catch (error) {
        if (overdue()) throw unfinished();
        if ((cancellable && controller.signal.aborted) || (error && error.name === 'AbortError')) throw new HistoryError('CANCELLED', 'The recognition was cancelled');
        throw new HistoryError('NETWORK', `The Kizuna AI service could not be reached: ${spoken(error && error.message, token)}`);
      }
      if (!response.ok) {
        let answer = null;
        try {
          answer = await response.json();
        } catch {
          // No body is a refusal without words; a body cut short by the wait running out, or by a cancel, is that.
          if (overdue()) throw unfinished();
          if (cancellable && controller.signal.aborted) throw new HistoryError('CANCELLED', 'The recognition was cancelled');
        }
        throw Object.assign(hostedRefusal(response.status, answer, { starting, payer, token }), { status: response.status });
      }
      if (response.status === 204) return null;
      // A success whose body is no JSON (a proxy's page, a connection dropped mid-body) is the service's failure; a
      // cancel landing while it is read is a cancel.
      try {
        return await response.json();
      } catch (error) {
        if (overdue()) throw unfinished();
        if ((cancellable && controller.signal.aborted) || (error && error.name === 'AbortError')) throw new HistoryError('CANCELLED', 'The recognition was cancelled');
        throw new HistoryError('SERVICE', `The Kizuna AI service sent an unreadable answer (${response.status}): ${spoken(error && error.message, token)}`);
      }
    }
    const checkCancelled = () => {
      if (controller.signal.aborted) throw new HistoryError('CANCELLED', 'The recognition was cancelled');
    };
    const unfinished = () => new HistoryError('SERVICE', `The Kizuna AI service did not finish the transcription within ${hostedMaxWaitMs / 60_000} minutes`);

    /** Ends the job, asking again after a network failure or a 5xx; one the service no longer has is ended. */
    async function endFileJob(id) {
      for (let retries = 0; ; retries++) {
        try {
          await call('DELETE', `/${encodeURIComponent(id)}`, { cancellable: false });
          return;
        } catch (error) {
          if (error.status === 404) return;
          if (retries >= END_RETRIES || !(error.code === 'NETWORK' || error.status >= 500)) {
            logger.warn(`[Sokuji] [History] Kizuna AI file job ${id} was not ended: ${error.message}`);
            return;
          }
          await later(DELETE_RETRY_MS);
        }
      }
    }

    try {
      const blob = await openBlob(file, { type: 'audio/ogg' });
      const query = new URLSearchParams({ region, audio_ms: String(track.durationMs), translated: translateTo !== undefined ? '1' : '0' });
      if (laterAudioMs > 0) query.set('later_audio_ms', String(laterAudioMs));
      if (payer !== undefined) query.set('payer', payer);
      const started = await call('POST', `?${query}`, { blob, starting: true });
      if (!isString(started && started.id)) throw new HistoryError('SERVICE', 'The Kizuna AI service did not name the job');
      fileJobId = started.id;
      const at = `/${encodeURIComponent(fileJobId)}`;
      checkCancelled();
      job.phase = 'queued';
      await call('POST', `${at}/transcription`, {
        json: {
          language_hints: languageHints,
          // One way: what is already in that language is left as it is.
          ...(translateTo !== undefined ? { translation: { type: 'one_way', target_language: translateTo } } : {}),
          ...(context !== undefined ? { context } : {}),
        },
      });
      let state;
      /** Polls in a row whose state could not be had; a passing failure is asked again at the next poll. */
      let failedPolls = 0;
      const pollingSince = now();
      for (;;) {
        checkCancelled();
        // A job the service never finishes is not waited for for ever; the job is still ended there below.
        if (now() - pollingSince > hostedMaxWaitMs) throw unfinished();
        try {
          await wait(POLL_MS, controller.signal);
        } catch {
          checkCancelled();
        }
        try {
          // The wait bounds the call too: an answer begun and never ended would otherwise be read for ever.
          state = await call('GET', at, { withinMs: Math.max(1, hostedMaxWaitMs - (now() - pollingSince)) });
        } catch (error) {
          if (failedPolls < POLL_RETRIES && (error.code === 'NETWORK' || error.status >= 500)) {
            failedPolls += 1;
            continue;
          }
          throw error;
        }
        failedPolls = 0;
        checkCancelled();
        const status = state && state.status;
        if (status === 'completed') break;
        if (status === 'error') throw failedFileJob(String(state.error_type || ''), token);
        job.phase = status === 'processing' ? 'processing' : 'queued';
      }
      job.phase = 'fetching';
      const transcript = await call('GET', `${at}/transcript`);
      checkCancelled();
      return { tokens: Array.isArray(transcript && transcript.tokens) ? transcript.tokens : [], audioMs: Number(state.audio_duration_ms) || 0 };
    } finally {
      jobs.delete(jobId);
      if (fileJobId) {
        const cleanup = endFileJob(fileJobId);
        cleanups.add(cleanup);
        void cleanup.finally(() => cleanups.delete(cleanup));
        // A cancel answers at once; the job is ended after, by itself.
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
