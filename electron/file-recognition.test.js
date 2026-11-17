// @vitest-environment node
// electron/file-recognition.test.js
//
// A kept track sent to Soniox's file recognition: upload, transcription, the words back, and nothing left at Soniox.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
