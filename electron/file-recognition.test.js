// @vitest-environment node
// electron/file-recognition.test.js
//
// A kept track sent to Soniox's file recognition: upload, transcription, the words back, and nothing left at Soniox.
// The same through the Kizuna AI service, for Kizuna AI's Soniox: the job is ended there in every outcome.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { openHistory } = nodeRequire('./history-store.js');
const { createFileRecognizer, sonioxApiHost, SONIOX_REGIONS: MAIN_REGIONS } = nodeRequire('./file-recognition.js');
import { SONIOX_REGIONS, sonioxHosts } from '../src/lib/soniox/regions';

const ID = 'run-0001-aaaa';
const KEY = 'sk-test-0123456789';
const TOKENS = [
  { text: 'Hello', start_ms: 100, end_ms: 400, speaker: '1', language: 'en', confidence: 0.99 },
  { text: '.', start_ms: 400, end_ms: 420, speaker: '1', language: 'en', confidence: 0.99 },
];
let dir;
let store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sokuji-file-recognition-'));
  store = openHistory({ dir });
  store.openRecord({ id: ID, startedAt: 1_800_000_000_000, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'fake', models: {} }, appVersion: '1' });
  store.appendTrack({ recordId: ID, source: 'participant', offsetMs: 0, durationMs: 1000, data: new Uint8Array([1, 2, 3, 4]) });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A Soniox that answers each call from a script: `statuses` are what successive polls see. Every call is recorded as
 * `METHOD url`, with the parsed body of a JSON request and the auth header.
 */
function fakeSoniox(o = {}) {
  const calls = [];
  const statuses = [...(o.statuses ?? ['queued', 'processing', 'completed'])];
  const refusals = o.refusals ?? {};
  let deleteTranscriptionRefusals = o.deleteTranscriptionRefusals ?? 0;
  const hangs = new Set(o.hangs ?? []);
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const u = new URL(url);
    const entry = { method, host: u.host, path: u.pathname, auth: init.headers?.Authorization, body: init.body };
    if (typeof init.body === 'string') entry.json = JSON.parse(init.body);
    calls.push(entry);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const key = `${method} ${u.pathname}`;
    // A call that never answers: only its signal ends it.
    if (hangs.has(key)) {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: init.signal.reason?.name ?? 'AbortError' })), { once: true });
      });
    }
    if (refusals[key]) return json(refusals[key].status, refusals[key].body ?? { message: 'refused' });
    if (key === 'POST /v1/files') return json(201, { id: 'file-1' });
    if (key === 'POST /v1/transcriptions') return json(201, { id: 'tr-1', status: 'queued' });
    if (key === 'GET /v1/transcriptions/tr-1') {
      const status = statuses.length > 1 ? statuses.shift() : statuses[0];
      o.onPoll?.(status);
      return json(200, { id: 'tr-1', status, audio_duration_ms: 1000, ...(status === 'error' ? o.error : {}) });
    }
    if (key === 'GET /v1/transcriptions/tr-1/transcript') return json(200, { id: 'tr-1', text: 'Hello.', tokens: TOKENS });
    if (key === 'DELETE /v1/transcriptions/tr-1') {
      if (o.transcriptionGone) return json(404, { message: 'not found' });
      if (deleteTranscriptionRefusals > 0) { deleteTranscriptionRefusals -= 1; return json(409, { message: 'still processing' }); }
      return new Response(null, { status: 204 });
    }
    if (key === 'DELETE /v1/files/file-1') return new Response(null, { status: 204 });
    return json(404, { message: 'not found' });
  };
  return { calls, fetch, paths: () => calls.map((c) => `${c.method} ${c.path}`) };
}

const instant = async () => {};
const request = (over = {}) => ({ store, recordId: ID, service: 'soniox', source: 'participant', apiKey: KEY, region: 'us', languageHints: ['en'], jobId: 'job-1', ...over });

describe('Soniox file recognition', () => {
  it('names the REST host of the key’s region', () => {
    expect(sonioxApiHost('us')).toBe('api.soniox.com');
    expect(sonioxApiHost('eu')).toBe('api.eu.soniox.com');
    expect(sonioxApiHost('jp')).toBe('api.jp.soniox.com');
  });

  it('uploads the kept track, waits for the transcription, returns its words, and deletes both at Soniox', async () => {
    const soniox = fakeSoniox();
    const waits = [];
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: async (ms) => { waits.push(ms); } });
    const result = await recognizer.recognize(request({ region: 'eu' }));
    expect(result).toEqual({ tokens: TOKENS, audioMs: 1000 });
    expect(soniox.paths()).toEqual([
      'POST /v1/files', 'POST /v1/transcriptions',
      'GET /v1/transcriptions/tr-1', 'GET /v1/transcriptions/tr-1', 'GET /v1/transcriptions/tr-1',
      'GET /v1/transcriptions/tr-1/transcript',
      'DELETE /v1/files/file-1', 'DELETE /v1/transcriptions/tr-1',
    ]);
    expect(new Set(soniox.calls.map((c) => c.host))).toEqual(new Set(['api.eu.soniox.com']));
    expect(soniox.calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    const upload = soniox.calls[0].body;
    expect(upload).toBeInstanceOf(FormData);
    const file = upload.get('file');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(soniox.calls[1].json).toEqual({
      model: 'stt-async-v6', file_id: 'file-1', enable_speaker_diarization: true, enable_language_identification: true,
      language_hints: ['en'], client_reference_id: 'job-1',
    });
    expect(waits).toEqual([5000, 5000, 5000]);
  });

  it('asks for the translation into the language given, and sends the word list as its context', async () => {
    const soniox = fakeSoniox();
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant });
    const context = { terms: ['Sokuji'], translation_terms: [{ source: 'Kizuna', target: '絆' }], text: 'A weekly meeting.' };
    await recognizer.recognize(request({ languageHints: ['ja', 'en'], translateTo: 'zh', context }));
    expect(soniox.calls[1].json).toEqual({
      model: 'stt-async-v6', file_id: 'file-1', enable_speaker_diarization: true, enable_language_identification: true,
      language_hints: ['ja', 'en'], context, translation: { type: 'one_way', target_language: 'zh' }, client_reference_id: 'job-1',
    });
  });

  it('refuses a context or a translation it could not send as given, before calling Soniox', async () => {
    const soniox = fakeSoniox();
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant });
    for (const over of [
      { translateTo: '' }, { translateTo: 7 }, { context: 'terms' }, { context: { terms: [1] } }, { context: { text: 3 } },
      { context: { translation_terms: [{ source: 'a' }] } }, { context: { unknown: [] } },
    ]) {
      await expect(recognizer.recognize(request(over)), JSON.stringify(over)).rejects.toMatchObject({ code: 'BAD_INPUT' });
    }
    expect(soniox.calls).toEqual([]);
  });

  it('says which phase a job is in, and nothing once it has ended', async () => {
    const seen = [];
    let recognizer;
    const soniox = fakeSoniox({ onPoll: () => seen.push(recognizer.status('job-1')) });
    recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant });
    await recognizer.recognize(request());
    expect(seen).toEqual([{ phase: 'queued' }, { phase: 'queued' }, { phase: 'processing' }]);
    expect(recognizer.status('job-1')).toBeNull();
  });

  it('refuses a track that is not kept, before calling Soniox', async () => {
    const soniox = fakeSoniox();
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant });
    await expect(recognizer.recognize(request({ source: 'speaker' }))).rejects.toMatchObject({ code: 'NO_TRACK' });
    expect(soniox.calls).toEqual([]);
  });

  it('turns each refusal into a code, deletes what was uploaded, and never repeats the key', async () => {
    const cases = [
      [{ 'POST /v1/files': { status: 401, body: { message: `bad key ${KEY}` } } }, 'NO_KEY', ['POST /v1/files']],
      [{ 'POST /v1/transcriptions': { status: 403 } }, 'NO_KEY', ['POST /v1/files', 'POST /v1/transcriptions', 'DELETE /v1/files/file-1']],
      [{ 'POST /v1/transcriptions': { status: 402 } }, 'NO_CREDIT', ['POST /v1/files', 'POST /v1/transcriptions', 'DELETE /v1/files/file-1']],
      [{ 'POST /v1/transcriptions': { status: 429, body: { message: 'Organization balance exhausted (quota)' } } }, 'NO_CREDIT', null],
      [{ 'POST /v1/transcriptions': { status: 429, body: { message: 'Too many requests' } } }, 'SERVICE', null],
      [{ 'POST /v1/files': { status: 413 } }, 'TOO_LONG', null],
      [{ 'POST /v1/files': { status: 500 } }, 'SERVICE', null],
    ];
    for (const [refusals, code, paths] of cases) {
      const soniox = fakeSoniox({ refusals });
      const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant });
      const error = await recognizer.recognize(request()).then(() => null, (e) => e);
      expect(error, code).toMatchObject({ code });
      expect(error.message).not.toContain(KEY);
      if (paths) expect(soniox.paths()).toEqual(paths);
    }
  });

  it('a transcription that failed at Soniox: the audio reason, and both deleted', async () => {
    const soniox = fakeSoniox({ statuses: ['processing', 'error'], error: { error_type: 'invalid_audio', error_message: 'The audio could not be decoded' } });
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant });
    await expect(recognizer.recognize(request())).rejects.toMatchObject({ code: 'BAD_AUDIO' });
    expect(soniox.paths().slice(-2)).toEqual(['DELETE /v1/files/file-1', 'DELETE /v1/transcriptions/tr-1']);
  });

  it('a network failure is NETWORK', async () => {
    const recognizer = createFileRecognizer({ fetch: async () => { throw new TypeError('fetch failed'); }, wait: instant });
    await expect(recognizer.recognize(request())).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('a cancel while Soniox processes: CANCELLED, the file deleted at once, the transcription once it can be', async () => {
    let recognizer;
    const soniox = fakeSoniox({
      statuses: ['processing', 'processing', 'processing', 'completed'],
      deleteTranscriptionRefusals: 2,
      onPoll: (status) => { if (status === 'processing') recognizer.cancel('job-1'); },
    });
    const retries = [];
    recognizer = createFileRecognizer({
      fetch: soniox.fetch,
      wait: async (ms, signal) => { if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
      later: async (ms) => { retries.push(ms); },
    });
    await expect(recognizer.recognize(request())).rejects.toMatchObject({ code: 'CANCELLED' });
    await recognizer.settled();
    const paths = soniox.paths();
    expect(paths).toContain('DELETE /v1/files/file-1');
    expect(paths.filter((p) => p === 'DELETE /v1/transcriptions/tr-1')).toHaveLength(3);
    expect(retries).toEqual([5000, 5000]);
    expect(paths).not.toContain('GET /v1/transcriptions/tr-1/transcript');
    expect(recognizer.status('job-1')).toBeNull();
  });

  it('a cancel during the upload: CANCELLED and nothing more is asked', async () => {
    let recognizer;
    const soniox = fakeSoniox();
    const fetch = async (url, init) => {
      if (new URL(url).pathname === '/v1/files' && init.method === 'POST') recognizer.cancel('job-1');
      return soniox.fetch(url, init);
    };
    recognizer = createFileRecognizer({ fetch, wait: instant });
    await expect(recognizer.recognize(request())).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(soniox.paths().filter((p) => p.startsWith('POST'))).toEqual(['POST /v1/files']);
  });

  it('refuses a request without a key, region or job id', async () => {
    const recognizer = createFileRecognizer({ fetch: fakeSoniox().fetch, wait: instant });
    await expect(recognizer.recognize(request({ apiKey: '' }))).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(recognizer.recognize(request({ region: 'mars' }))).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(recognizer.recognize(request({ jobId: '' }))).rejects.toMatchObject({ code: 'BAD_INPUT' });
  });

  it('refuses a service it has no recognizer for', async () => {
    const soniox = fakeSoniox();
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant });
    await expect(recognizer.recognize(request({ service: 'qwen' }))).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect(soniox.calls).toEqual([]);
  });

  it("reads an upload Soniox could not decode as the audio's fault", async () => {
    const soniox = fakeSoniox({ refusals: { 'POST /v1/files': { status: 400, body: { error_type: 'invalid_audio_file', message: 'Cannot decode audio' } } } });
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant });
    await expect(recognizer.recognize(request())).rejects.toMatchObject({ code: 'BAD_AUDIO' });
  });
  it('knows the regions, and their REST hosts, that the app knows', () => {
    expect([...MAIN_REGIONS].sort()).toEqual([...SONIOX_REGIONS].sort());
    for (const region of SONIOX_REGIONS) expect(sonioxApiHost(region)).toBe(sonioxHosts(region).api);
  });

  it('takes a transcription Soniox no longer has as deleted: no asking again', async () => {
    const soniox = fakeSoniox({ statuses: ['error'], error: { error_type: 'internal' }, transcriptionGone: true });
    const retries = [];
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant, later: async (ms) => { retries.push(ms); }, logger: { warn: () => {} } });
    await expect(recognizer.recognize(request())).rejects.toMatchObject({ code: 'SERVICE' });
    expect(soniox.paths().filter((p) => p === 'DELETE /v1/transcriptions/tr-1')).toHaveLength(1);
    expect(retries).toEqual([]);
  });

  it('a cancel answers at once; what was uploaded is deleted after', async () => {
    let recognizer;
    const soniox = fakeSoniox({ statuses: ['processing', 'processing', 'completed'], onPoll: () => recognizer.cancel('job-1'), hangs: ['DELETE /v1/files/file-1'] });
    recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant, cleanupTimeoutMs: 50, logger: { warn: () => {} } });
    const outcome = await Promise.race([
      recognizer.recognize(request()).then(() => 'done', (e) => e.code),
      new Promise((resolve) => { setTimeout(() => resolve('still waiting'), 30); }),
    ]);
    expect(outcome).toBe('CANCELLED');
    await recognizer.settled();
    expect(soniox.paths()).toContain('DELETE /v1/files/file-1');
    expect(soniox.paths()).toContain('DELETE /v1/transcriptions/tr-1');
  });

  it('gives up a clean-up call that does not answer, so the result is not held', async () => {
    const warned = [];
    const soniox = fakeSoniox({ hangs: ['DELETE /v1/files/file-1'] });
    const recognizer = createFileRecognizer({ fetch: soniox.fetch, wait: instant, cleanupTimeoutMs: 20, logger: { warn: (m) => warned.push(m) } });
    const result = await recognizer.recognize(request());
    expect(result.tokens).toHaveLength(2);
    expect(warned.some((m) => m.includes('file-1'))).toBe(true);
    expect(warned.join(' ')).not.toContain(KEY);
  });
});

const API_URL = 'https://service.test/api';
const TOKEN = 'session-token-0123456789';
/** The page's id of the job; the service names its own job `job-1`. */
const JOB = 'page-job-1';
const START = 'POST /soniox/file-jobs';
const TRANSCRIBE = 'POST /soniox/file-jobs/job-1/transcription';
const STATE = 'GET /soniox/file-jobs/job-1';
const TRANSCRIPT = 'GET /soniox/file-jobs/job-1/transcript';
const END = 'DELETE /soniox/file-jobs/job-1';

/**
 * The Kizuna AI service answering each call from a script: `statuses` are what successive state calls see (a state,
 * or a failed poll: an HTTP status, or 'throw' for a network failure), `ends` what successive ends answer (a status,
 * or 'throw'), `refusals` a call refused with its JSON `body`, or with a page's `text` (a proxy's, not the service's).
 * Every call is recorded with its path below the service's address, its query, auth and content type, and
 * its body: the bytes of an upload, the parsed JSON of a request. `onCall(key)` runs as a call arrives; a call in
 * `hangs` never answers (only its signal ends it), one in `holds` waits until the test rejects it through `pending`,
 * one in `bodies` is answered by `bodies[key](signal)`.
 */
function fakeService(o = {}) {
  const calls = [];
  const statuses = [...(o.statuses ?? ['queued', 'processing', 'completed'])];
  const ends = [...(o.ends ?? [204])];
  const refusals = o.refusals ?? {};
  const hangs = new Set(o.hangs ?? []);
  const holds = new Set(o.holds ?? []);
  const pending = new Map();
  const prefix = new URL(API_URL).pathname;
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const u = new URL(url);
    const entry = {
      method, url: String(url), path: u.pathname.startsWith(prefix) ? u.pathname.slice(prefix.length) : u.pathname, query: u.search.slice(1),
      auth: init.headers?.Authorization, contentType: init.headers?.['Content-Type'],
    };
    if (typeof init.body === 'string') entry.json = JSON.parse(init.body);
    else if (init.body !== undefined) entry.bodyBytes = new Uint8Array(await new Response(init.body).arrayBuffer());
    calls.push(entry);
    const key = `${method} ${entry.path}`;
    o.onCall?.(key);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (hangs.has(key)) {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: init.signal.reason?.name ?? 'AbortError' })), { once: true });
      });
    }
    if (holds.has(key)) return new Promise((_, reject) => { pending.set(key, reject); });
    if (refusals[key]) {
      const { status, body, text } = refusals[key];
      return text !== undefined ? new Response(text, { status, headers: { 'Content-Type': 'text/html' } }) : json(status, body);
    }
    if (o.bodies?.[key]) return o.bodies[key](init.signal);
    if (key === START) return json(201, { id: 'job-1', estimateMicroUsd: 56, region: 'jp' });
    if (key === TRANSCRIBE) return json(201, { id: 'job-1', status: 'queued' });
    if (key === STATE) {
      const status = statuses.length > 1 ? statuses.shift() : statuses[0];
      if (status === 'throw') throw new TypeError('fetch failed');
      if (typeof status === 'number') return json(status, { error: 'Unavailable', code: 'service_unavailable' });
      return json(200, { id: 'job-1', status, audio_duration_ms: 1000, ...(status === 'error' ? o.error : {}) });
    }
    if (key === TRANSCRIPT) return json(200, { id: 'job-1', text: 'Hello.', tokens: TOKENS });
    if (key === END) {
      const end = ends.length > 1 ? ends.shift() : ends[0];
      if (end === 'throw') throw new TypeError(`fetch failed for ${TOKEN}`);
      return end === 204 ? new Response(null, { status: 204 }) : json(end, { error: 'Unavailable', code: 'service_unavailable' });
    }
    return json(404, { error: 'Not found' });
  };
  return { calls, fetch, pending, paths: () => calls.map((c) => `${c.method} ${c.path}`) };
}

const hostedRequest = (over = {}) => ({
  store, recordId: ID, service: 'kizunaai_soniox', source: 'participant', apiUrl: API_URL, token: TOKEN, region: 'jp',
  languageHints: ['en'], jobId: JOB, ...over,
});
/** A refusal whose own text repeats the token: it must not come back in the error. */
const refused = (status, more = {}) => ({ status, body: { error: `Refused for ${TOKEN}`, ...more } });

describe('through the Kizuna AI service', () => {
  it('uploads the kept track, has it transcribed, returns its words, and ends the job at the service', async () => {
    const service = fakeService();
    const waits = [];
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: async (ms) => { waits.push(ms); } });
    const result = await recognizer.recognize(hostedRequest({ laterAudioMs: 0 }));
    expect(result).toEqual({ tokens: TOKENS, audioMs: 1000 });
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, STATE, STATE, TRANSCRIPT, END]);
    expect(service.calls.every((c) => c.url.startsWith(`${API_URL}/soniox/file-jobs`))).toBe(true);
    expect(service.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    const [upload, transcription] = service.calls;
    expect(upload.query).toBe('region=jp&audio_ms=1000&translated=0');
    expect(upload.contentType).toBe('audio/ogg');
    expect(upload.bodyBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(transcription.contentType).toBe('application/json');
    expect(transcription.json).toEqual({ language_hints: ['en'] });
    expect(waits).toEqual([5000, 5000, 5000]);
  });

  it('says it will translate, asks for the translation with the word list, and names the audio still to come and the payer', async () => {
    const service = fakeService();
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    const context = { terms: ['Sokuji'], translation_terms: [{ source: 'Kizuna', target: '絆' }], text: 'A weekly meeting.' };
    await recognizer.recognize(hostedRequest({ languageHints: ['ja', 'en'], translateTo: 'zh', context, laterAudioMs: 2500, payer: 'organization' }));
    expect(service.calls[0].query).toBe('region=jp&audio_ms=1000&translated=1&later_audio_ms=2500&payer=organization');
    expect(service.calls[1].json).toEqual({ language_hints: ['ja', 'en'], translation: { type: 'one_way', target_language: 'zh' }, context });
  });

  it('takes the length and the bytes from the kept track, not from the request', async () => {
    store.appendTrack({ recordId: ID, source: 'participant', offsetMs: 0, durationMs: 2500, data: new Uint8Array([5, 6]) });
    const service = fakeService();
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    await recognizer.recognize(hostedRequest({ audioMs: 999_999, durationMs: 7 }));
    expect(service.calls[0].query).toBe('region=jp&audio_ms=2500&translated=0');
    expect(service.calls[0].bodyBytes).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('says which phase a job is in, and nothing once it has ended', async () => {
    const seen = [];
    let recognizer;
    const service = fakeService({ onCall: () => seen.push(recognizer.status(JOB)) });
    recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    await recognizer.recognize(hostedRequest());
    expect(seen).toEqual([
      { phase: 'uploading' }, { phase: 'queued' }, { phase: 'queued' }, { phase: 'queued' }, { phase: 'processing' }, { phase: 'fetching' }, null,
    ]);
  });

  it('turns each refusal into a code, ends a job the service has named, and never repeats the token or the service\'s text', async () => {
    const cases = [
      [{ [START]: refused(401, { code: 'sign_in_required' }) }, 'SIGN_IN', [START]],
      [{ [START]: refused(402, { code: 'insufficient_balance' }) }, 'NO_BALANCE', [START]],
      [{ [TRANSCRIBE]: refused(402, { code: 'insufficient_balance' }) }, 'NO_BALANCE', [START, TRANSCRIBE, END]],
      [{ [START]: refused(402, { code: 'insufficient_balance' }) }, 'ORG_NO_BALANCE', [START], { payer: 'organization' }],
      [{ [START]: refused(402, { code: 'insufficient_balance', reason: 'org_balance_held' }) }, 'ORG_BALANCE_HELD', [START], { payer: 'organization' }],
      [{ [TRANSCRIBE]: refused(403, { code: 'not_org_member' }) }, 'NOT_ORG_MEMBER', [START, TRANSCRIBE, END], { payer: 'organization' }],
      [{ [START]: refused(403, { code: 'wallet_frozen', subject: 'organization' }) }, 'ORG_WALLET_FROZEN', [START], { payer: 'organization' }],
      [{ [START]: refused(403, { code: 'wallet_frozen' }) }, 'WALLET_FROZEN', [START]],
      // A 403 the service does not explain as a frozen wallet is its failure: no code, another code, a subject alone,
      // a proxy's page.
      [{ [START]: refused(403) }, 'SERVICE', [START]],
      [{ [START]: refused(403, { code: 'forbidden' }) }, 'SERVICE', [START]],
      [{ [START]: refused(403, { subject: 'organization' }) }, 'SERVICE', [START], { payer: 'organization' }],
      [{ [TRANSCRIBE]: { status: 403, text: `<html>Forbidden ${TOKEN}</html>` } }, 'SERVICE', [START, TRANSCRIBE, END]],
      [{ [START]: refused(404) }, 'HOSTED_UNAVAILABLE', [START]],
      [{ [TRANSCRIBE]: refused(404) }, 'SERVICE', [START, TRANSCRIBE, END]],
      [{ [START]: refused(409, { code: 'file_job_running' }) }, 'JOB_RUNNING', [START]],
      [{ [TRANSCRIBE]: refused(409, { code: 'wrong_state' }) }, 'SERVICE', [START, TRANSCRIBE, END]],
      [{ [START]: refused(413, { code: 'too_long', maxAudioMs: 14_400_000, maxBytes: 100_663_296 }) }, 'HOSTED_TOO_LONG', [START]],
      [{ [TRANSCRIBE]: refused(413, { code: 'request_too_large' }) }, 'SERVICE', [START, TRANSCRIBE, END]],
      [{ [TRANSCRIBE]: refused(422, { code: 'bad_audio' }) }, 'BAD_AUDIO', [START, TRANSCRIBE, END]],
      [{ [START]: refused(400, { code: 'invalid_request' }) }, 'SERVICE', [START]],
      [{ [START]: refused(503, { code: 'region_unavailable' }) }, 'SERVICE', [START]],
      // A 5xx to the state is asked again at the next polls: the fourth in a row ends the job.
      [{ [STATE]: refused(503, { code: 'service_unavailable' }) }, 'SERVICE', [START, TRANSCRIBE, STATE, STATE, STATE, STATE, END]],
      [{ [STATE]: refused(404) }, 'SERVICE', [START, TRANSCRIBE, STATE, END]],
    ];
    for (const [refusals, code, paths, over] of cases) {
      const service = fakeService({ refusals });
      const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
      const error = await recognizer.recognize(hostedRequest(over)).then(() => null, (e) => e);
      const refusal = Object.values(refusals)[0];
      const label = `${Object.keys(refusals)[0]} ${refusal.status} ${JSON.stringify(refusal.body ?? refusal.text)}`;
      expect(error, label).toMatchObject({ code });
      expect(error.message, label).not.toContain(TOKEN);
      expect(error.message, label).not.toContain('Refused for');
      expect(service.paths(), label).toEqual(paths);
    }
  });

  it('a sign-in that no longer holds at the start: SIGN_IN, and nothing more is asked', async () => {
    const service = fakeService({ refusals: { [START]: refused(401, { code: 'sign_in_required' }) } });
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    await expect(recognizer.recognize(hostedRequest())).rejects.toMatchObject({ code: 'SIGN_IN' });
    await recognizer.settled();
    expect(service.paths()).toEqual([START]);
  });

  it('a job the service gave up on: the audio reason when it is the audio, else SERVICE; the job ended either way', async () => {
    for (const [errorType, code] of [['audio_decode_failed', 'BAD_AUDIO'], ['unsupported_format', 'BAD_AUDIO'], ['internal_error', 'SERVICE']]) {
      const service = fakeService({ statuses: ['processing', 'error'], error: { error_type: errorType } });
      const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
      const error = await recognizer.recognize(hostedRequest()).then(() => null, (e) => e);
      expect(error, errorType).toMatchObject({ code });
      expect(service.paths(), errorType).toEqual([START, TRANSCRIBE, STATE, STATE, END]);
    }
  });

  it('a job the service gave up on for its length: HOSTED_TOO_LONG, though the type names the audio too; the job ended', async () => {
    for (const errorType of ['audio_duration_exceeded', 'file_too_long', 'max_length']) {
      const service = fakeService({ statuses: ['processing', 'error'], error: { error_type: errorType } });
      const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
      const error = await recognizer.recognize(hostedRequest()).then(() => null, (e) => e);
      expect(error, errorType).toMatchObject({ code: 'HOSTED_TOO_LONG' });
      expect(service.paths(), errorType).toEqual([START, TRANSCRIBE, STATE, STATE, END]);
    }
  });

  it('a network failure is NETWORK, and its text never repeats the token', async () => {
    const recognizer = createFileRecognizer({ fetch: async () => { throw new TypeError(`connect failed for ${TOKEN}`); }, wait: instant });
    const error = await recognizer.recognize(hostedRequest()).then(() => null, (e) => e);
    expect(error).toMatchObject({ code: 'NETWORK' });
    expect(error.message).not.toContain(TOKEN);
  });

  it('a cancel in any phase: CANCELLED, and the job ended at the service once it has an id', async () => {
    for (const [phase, paths] of [
      ['uploading', [START]],
      ['queued', [START, TRANSCRIBE, END]],
      ['processing', [START, TRANSCRIBE, STATE, STATE, STATE, END]],
      ['fetching', [START, TRANSCRIBE, STATE, STATE, STATE, TRANSCRIPT, END]],
    ]) {
      let recognizer;
      const service = fakeService({ onCall: () => { if (recognizer.status(JOB)?.phase === phase) recognizer.cancel(JOB); } });
      recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
      await expect(recognizer.recognize(hostedRequest()), phase).rejects.toMatchObject({ code: 'CANCELLED' });
      await recognizer.settled();
      expect(service.paths(), phase).toEqual(paths);
      expect(recognizer.status(JOB), phase).toBeNull();
    }
  });

  it('a cancel as the service names the job: CANCELLED, and that job is ended', async () => {
    let recognizer;
    const service = fakeService();
    const fetch = async (url, init) => {
      const answer = await service.fetch(url, init);
      if (init.method === 'POST' && new URL(url).pathname.endsWith('/soniox/file-jobs')) recognizer.cancel(JOB);
      return answer;
    };
    recognizer = createFileRecognizer({ fetch, wait: instant });
    await expect(recognizer.recognize(hostedRequest())).rejects.toMatchObject({ code: 'CANCELLED' });
    await recognizer.settled();
    expect(service.paths()).toEqual([START, END]);
  });

  it('a cancel answers at once; the job is ended after', async () => {
    let recognizer;
    const service = fakeService({ onCall: (key) => { if (key === STATE) recognizer.cancel(JOB); }, hangs: [END] });
    recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant, later: instant, cleanupTimeoutMs: 50, logger: { warn: () => {} } });
    const outcome = await Promise.race([
      recognizer.recognize(hostedRequest()).then(() => 'done', (e) => e.code),
      new Promise((resolve) => { setTimeout(() => resolve('still waiting'), 30); }),
    ]);
    expect(outcome).toBe('CANCELLED');
    await recognizer.settled();
    expect(service.paths()).toContain(END);
  });

  it('ends the job at the service though nobody awaits the result (the page went away)', async () => {
    const service = fakeService({ holds: [TRANSCRIPT] });
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    // The caller is gone: nothing awaits this recognition.
    void recognizer.recognize(hostedRequest()).catch(() => {});
    await vi.waitUntil(() => service.pending.has(TRANSCRIPT));
    service.pending.get(TRANSCRIPT)(new TypeError('fetch failed'));
    // Once the job is over its end is under way, and settled() awaits it.
    await vi.waitUntil(() => recognizer.status(JOB) === null);
    await recognizer.settled();
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, STATE, STATE, TRANSCRIPT, END]);
  });

  it('asks for the state again at the next poll after a network failure or a 5xx, and forgets them once it is had', async () => {
    for (const statuses of [
      [503, 'throw', 'completed'],
      ['throw', 503, 'throw', 'queued', 503, 'throw', 503, 'completed'],
    ]) {
      const service = fakeService({ statuses });
      const waits = [];
      const recognizer = createFileRecognizer({ fetch: service.fetch, wait: async (ms) => { waits.push(ms); } });
      const result = await recognizer.recognize(hostedRequest());
      expect(result, JSON.stringify(statuses)).toEqual({ tokens: TOKENS, audioMs: 1000 });
      expect(service.paths(), JSON.stringify(statuses)).toEqual([START, TRANSCRIBE, ...statuses.map(() => STATE), TRANSCRIPT, END]);
      expect(waits, JSON.stringify(statuses)).toEqual(statuses.map(() => 5000));
    }
  });

  it('gives up at the fourth failed poll in a row, and ends the job', async () => {
    for (const [failure, code] of [['throw', 'NETWORK'], [503, 'SERVICE']]) {
      const service = fakeService({ statuses: ['queued', failure] });
      const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
      await expect(recognizer.recognize(hostedRequest()), code).rejects.toMatchObject({ code });
      expect(service.paths(), code).toEqual([START, TRANSCRIBE, STATE, STATE, STATE, STATE, STATE, END]);
    }
  });

  it('a success whose answer cannot be read: SERVICE, its text without the token; at the start nothing more is asked', async () => {
    const html = () => new Response(`<html>Bad gateway ${TOKEN}</html>`, { status: 201, headers: { 'Content-Type': 'text/html' } });
    // The connection drops halfway through the body.
    const dropped = () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"id":"job-1","tok')); c.error(new TypeError(`terminated ${TOKEN}`)); },
    }), { status: 200 });
    for (const [bodies, paths] of [
      [{ [START]: html }, [START]],
      [{ [TRANSCRIPT]: dropped }, [START, TRANSCRIBE, STATE, STATE, STATE, TRANSCRIPT, END]],
    ]) {
      const service = fakeService({ bodies });
      const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
      const error = await recognizer.recognize(hostedRequest()).then(() => null, (e) => e);
      expect(error).toMatchObject({ code: 'SERVICE' });
      expect(error.message).toContain('unreadable answer');
      expect(error.message).not.toContain(TOKEN);
      await recognizer.settled();
      expect(service.paths()).toEqual(paths);
    }
  });

  it('a cancel landing while an answer is read: CANCELLED, and the job ended', async () => {
    // The state's body never ends on its own: only the call's signal ends it, as fetch's own body does.
    const stalled = (signal) => new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"id":"job-1",'));
        signal.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      },
    }), { status: 200 });
    const service = fakeService({ bodies: { [STATE]: stalled } });
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    const outcome = recognizer.recognize(hostedRequest()).then(() => 'done', (e) => e.code);
    await vi.waitUntil(() => service.paths().includes(STATE));
    recognizer.cancel(JOB);
    expect(await outcome).toBe('CANCELLED');
    await recognizer.settled();
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, END]);
  });

  it('a state answer that never ends is given up when the wait runs out: SERVICE, not a cancel, and the job ended', async () => {
    // As fetch's own body does: only the call's signal ends it, with the signal's reason.
    const stalled = (signal) => new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"id":"job-1",'));
        signal.addEventListener('abort', () => c.error(signal.reason), { once: true });
      },
    }), { status: 200 });
    const service = fakeService({ bodies: { [STATE]: stalled } });
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant, later: instant, hostedMaxWaitMs: 40 });
    const error = await recognizer.recognize(hostedRequest()).then(() => null, (e) => e);
    expect(error).toMatchObject({ code: 'SERVICE' });
    expect(error.message).toContain('did not finish the transcription');
    await recognizer.settled();
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, END]);
  });

  it('a refusal whose answer never ends is not read as the refusal: SERVICE when the wait runs out, CANCELLED on a cancel', async () => {
    // A 401 that begins its body and never ends it: read as a refusal it would say "sign in".
    const stalled = (signal) => new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"code":'));
        signal.addEventListener('abort', () => c.error(signal.reason), { once: true });
      },
    }), { status: 401 });
    const late = fakeService({ bodies: { [STATE]: stalled } });
    const waiting = createFileRecognizer({ fetch: late.fetch, wait: instant, later: instant, hostedMaxWaitMs: 40 });
    const error = await waiting.recognize(hostedRequest()).then(() => null, (e) => e);
    expect(error).toMatchObject({ code: 'SERVICE' });
    expect(error.message).toContain('did not finish the transcription');
    await waiting.settled();
    expect(late.paths()).toEqual([START, TRANSCRIBE, STATE, END]);

    const service = fakeService({ bodies: { [STATE]: stalled } });
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant, later: instant });
    const outcome = recognizer.recognize(hostedRequest()).then(() => 'done', (e) => e.code);
    await vi.waitUntil(() => service.paths().includes(STATE));
    recognizer.cancel(JOB);
    expect(await outcome).toBe('CANCELLED');
    await recognizer.settled();
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, END]);
  });

  it('a state call that never answers is given up when the wait runs out: SERVICE, and the job ended', async () => {
    const service = fakeService({ hangs: [STATE] });
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant, later: instant, hostedMaxWaitMs: 40 });
    await expect(recognizer.recognize(hostedRequest())).rejects.toMatchObject({ code: 'SERVICE' });
    await recognizer.settled();
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, END]);
  });

  it('a cancel landing while the poll waits: CANCELLED, and the job ended', async () => {
    let recognizer;
    let waits = 0;
    // The second wait is cut short by the cancel, as the real wait is by its signal.
    const wait = (ms, signal) => new Promise((resolve, reject) => {
      waits += 1;
      if (waits < 2) { resolve(); return; }
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      recognizer.cancel(JOB);
    });
    const service = fakeService();
    recognizer = createFileRecognizer({ fetch: service.fetch, wait });
    await expect(recognizer.recognize(hostedRequest())).rejects.toMatchObject({ code: 'CANCELLED' });
    await recognizer.settled();
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, END]);
    expect(recognizer.status(JOB)).toBeNull();
  });

  it('asks again to end the job after a 5xx or a network failure, three times at most, then gives up with one warning', async () => {
    for (const ends of [[503], ['throw']]) {
      const warned = [];
      const retries = [];
      const service = fakeService({ ends });
      const recognizer = createFileRecognizer({
        fetch: service.fetch, wait: instant, later: async (ms) => { retries.push(ms); }, logger: { warn: (m) => warned.push(m) },
      });
      const result = await recognizer.recognize(hostedRequest());
      expect(result.tokens, String(ends)).toHaveLength(2);
      expect(service.paths().filter((p) => p === END), String(ends)).toHaveLength(4);
      expect(retries, String(ends)).toEqual([5000, 5000, 5000]);
      expect(warned, String(ends)).toHaveLength(1);
      expect(warned[0]).toContain('job-1');
      expect(warned[0]).not.toContain(TOKEN);
    }
  });

  it('stops asking once the job is ended, and does not ask again after a refusal that is not the service failing', async () => {
    const answered = fakeService({ ends: [503, 'throw', 204] });
    const warned = [];
    let recognizer = createFileRecognizer({ fetch: answered.fetch, wait: instant, later: instant, logger: { warn: (m) => warned.push(m) } });
    await recognizer.recognize(hostedRequest());
    expect(answered.paths().filter((p) => p === END)).toHaveLength(3);
    expect(warned).toEqual([]);
    const refusedEnd = fakeService({ ends: [409] });
    recognizer = createFileRecognizer({ fetch: refusedEnd.fetch, wait: instant, later: instant, logger: { warn: (m) => warned.push(m) } });
    await recognizer.recognize(hostedRequest());
    expect(refusedEnd.paths().filter((p) => p === END)).toHaveLength(1);
    expect(warned).toHaveLength(1);
  });

  it('gives up an end that does not answer, so the result is not held for ever', async () => {
    const warned = [];
    const service = fakeService({ hangs: [END] });
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant, later: instant, cleanupTimeoutMs: 20, logger: { warn: (m) => warned.push(m) } });
    const result = await recognizer.recognize(hostedRequest());
    expect(result.tokens).toHaveLength(2);
    expect(service.paths().filter((p) => p === END)).toHaveLength(4);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('job-1');
  });

  it('refuses a request it could not send as given, before calling the service', async () => {
    const service = fakeService();
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    for (const over of [
      { token: undefined }, { token: '' }, { apiUrl: 'ftp://service.test/api' }, { apiUrl: 'not a url' }, { apiUrl: undefined },
      // The sign-in goes over https only; http to this computer alone.
      { apiUrl: 'http://service.test/api' }, { apiUrl: 'http://localhost.service.test/api' }, { apiUrl: 'http://10.0.0.1/api' },
      // An address with a query or a fragment would carry them into every call.
      { apiUrl: 'https://service.test/api?region=eu' }, { apiUrl: 'https://service.test/api?' }, { apiUrl: 'https://service.test/api#top' },
      { laterAudioMs: -1 }, { laterAudioMs: 1.5 }, { laterAudioMs: '0' }, { payer: 'someone' }, { region: 'mars' }, { jobId: '' },
      { languageHints: 'en' }, { translateTo: '' }, { context: { unknown: [] } },
    ]) {
      await expect(recognizer.recognize(hostedRequest(over)), JSON.stringify(over)).rejects.toMatchObject({ code: 'BAD_INPUT' });
    }
    expect(service.calls).toEqual([]);
  });

  it('sends the sign-in over http only to this computer, for development', async () => {
    for (const apiUrl of ['http://localhost:8787/api', 'http://127.0.0.1:8787/api', 'http://[::1]:8787/api']) {
      const service = fakeService();
      const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
      await recognizer.recognize(hostedRequest({ apiUrl }));
      expect(service.calls.every((c) => c.url.startsWith(`${apiUrl}/soniox/file-jobs`)), apiUrl).toBe(true);
      expect(service.paths(), apiUrl).toEqual([START, TRANSCRIBE, STATE, STATE, STATE, TRANSCRIPT, END]);
    }
  });

  it('takes the service’s address with a trailing slash, and calls below it without doubling the slash', async () => {
    const service = fakeService();
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    await recognizer.recognize(hostedRequest({ apiUrl: `${API_URL}/` }));
    expect(service.calls.every((c) => c.url.startsWith(`${API_URL}/soniox/file-jobs`))).toBe(true);
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, STATE, STATE, TRANSCRIPT, END]);
  });

  // A job the service never finishes is not polled for ever: after 60 minutes of polling it is the service's failure.
  it('gives up a job still running after 60 minutes of polling: SERVICE, and the job ended', async () => {
    let now = 1_800_000_000_000;
    const service = fakeService({ statuses: ['processing'] });
    // Each wait before a poll takes 15 minutes of the clock.
    const recognizer = createFileRecognizer({ fetch: service.fetch, now: () => now, wait: async () => { now += 15 * 60_000; } });
    const error = await recognizer.recognize(hostedRequest()).then(() => null, (e) => e);
    expect(error).toMatchObject({ code: 'SERVICE' });
    expect(error.message).not.toContain(TOKEN);
    // Polled at 15, 30, 45 and 60 minutes: at exactly 60 it polls once more (at 75); past 60 it asks no more.
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, STATE, STATE, STATE, STATE, END]);
  });

  it('counts the failed polls in the 60 minutes too', async () => {
    let now = 0;
    const service = fakeService({ statuses: ['processing', 503, 'processing', 'throw', 'processing'] });
    const recognizer = createFileRecognizer({ fetch: service.fetch, now: () => now, wait: async () => { now += 20 * 60_000; } });
    await expect(recognizer.recognize(hostedRequest())).rejects.toMatchObject({ code: 'SERVICE' });
    expect(service.paths()).toEqual([START, TRANSCRIBE, STATE, STATE, STATE, STATE, END]);
  });

  it('returns the words of a job that completes within the 60 minutes', async () => {
    let now = 0;
    // Completed at the poll 60 minutes in.
    const service = fakeService({ statuses: ['queued', 'processing', 'processing', 'completed'] });
    const recognizer = createFileRecognizer({ fetch: service.fetch, now: () => now, wait: async () => { now += 15 * 60_000; } });
    expect(await recognizer.recognize(hostedRequest())).toEqual({ tokens: TOKENS, audioMs: 1000 });
  });

  it('refuses a track that is not kept, before calling the service', async () => {
    const service = fakeService();
    const recognizer = createFileRecognizer({ fetch: service.fetch, wait: instant });
    await expect(recognizer.recognize(hostedRequest({ source: 'speaker' }))).rejects.toMatchObject({ code: 'NO_TRACK' });
    expect(service.calls).toEqual([]);
  });
});
