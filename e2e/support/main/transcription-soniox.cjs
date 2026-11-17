// A file transcription service in Soniox's shape (its async API: files, transcriptions, the transcript), answering
// what the test asked for in the service-neutral words of e2e/support/transcription.ts:
//   { sentences: [{ text, startMs, endMs, speaker? }] }  the transcription returns these sentences
//   { hold: true }                                         it stays at "transcribing" until `release()`
//   { fail: 'no-credit' | 'bad-key' | 'unreadable' | 'service', message? }  it fails, for that reason
// An answer is for the transcriptions started after it: each keeps the one it started with, whatever is answered later.
// Each upload and transcription is kept until the app deletes it, as Soniox keeps them: `kept()` is what is left.
// Every app launch is a new main process, so nothing carries over from one test to the next.
'use strict';

const DEFAULT = {
  sentences: [
    { text: 'This is the first sentence of the imported file.', startMs: 200, endMs: 1300 },
    { text: 'And this is the second one.', startMs: 1500, endMs: 2600 },
  ],
};

const files = new Map();
const jobs = new Map();
const asked = [];
let next = DEFAULT;
let ids = 0;

const control = {
  answerWith(answer) { next = answer; },
  /** The transcriptions held now finish; one started later is held, or not, as its own answer says. */
  release() { for (const job of jobs.values()) job.released = true; },
  asked: () => [...asked],
  kept: () => files.size + jobs.size,
};

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: body === undefined ? {} : { 'content-type': 'application/json' },
});
const refuse = (status, errorType, message) => json(status, { error_type: errorType, message });

/** The words of the sentences, one token each, spread over each sentence's time. */
function tokens(sentences) {
  const out = [];
  for (const s of sentences) {
    const words = s.text.split(' ');
    const step = (s.endMs - s.startMs) / words.length;
    words.forEach((word, i) => {
      out.push({
        // A space before every word but the transcript's first, as the service writes them.
        text: out.length === 0 ? word : ` ${word}`, start_ms: Math.round(s.startMs + i * step), end_ms: Math.round(s.startMs + (i + 1) * step),
        speaker: s.speaker ?? '1', language: 'en', confidence: 0.99,
      });
    });
  }
  return out;
}

async function answer(request, url) {
  const path = url.pathname;
  const method = request.method;
  asked.push(`${method} ${path}`);
  if (request.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  // A refused key refuses new work. What was started before goes on as it was told to, and is cleaned up.
  const badKey = () => refuse(401, 'unauthenticated', next.message ?? 'Invalid API key.');

  if (method === 'POST' && path === '/v1/files') {
    if (next.fail === 'bad-key') return badKey();
    if (next.fail === 'unreadable') return refuse(400, 'invalid_audio_file', next.message ?? 'The audio file could not be decoded.');
    const form = await request.formData();
    const file = form.get('file');
    const id = `file-${++ids}`;
    files.set(id, { bytes: file && typeof file.size === 'number' ? file.size : 0 });
    return json(201, { id });
  }
  if (method === 'POST' && path === '/v1/transcriptions') {
    if (next.fail === 'bad-key') return badKey();
    if (next.fail === 'no-credit') return refuse(402, 'insufficient_balance', next.message ?? 'Your account has no credit left.');
    const body = await request.json();
    const id = `transcription-${++ids}`;
    jobs.set(id, { fileId: body.file_id, answer: next, released: false });
    return json(201, { id, status: 'queued' });
  }
  const job = path.match(/^\/v1\/transcriptions\/([^/]+)(\/transcript)?$/);
  if (job && method === 'GET') {
    const found = jobs.get(job[1]);
    if (!found) return refuse(404, 'not_found', 'No such transcription.');
    const { answer: given, released } = found;
    // A held transcription, released, returns the default sentences.
    const sentences = given.sentences ?? DEFAULT.sentences;
    const status = given.fail === 'service' ? 'error' : given.hold && !released ? 'processing' : 'completed';
    // The transcript only once the transcription is complete, as the service answers.
    if (job[2]) {
      return status === 'completed'
        ? json(200, { id: job[1], text: '', tokens: tokens(sentences) })
        : refuse(409, 'invalid_state', `The transcription is ${status}, not completed.`);
    }
    if (status === 'error') return json(200, { id: job[1], status, error_type: 'internal_error', error_message: given.message ?? 'Transcription failed.' });
    if (status === 'processing') return json(200, { id: job[1], status });
    return json(200, { id: job[1], status, audio_duration_ms: sentences.length ? sentences[sentences.length - 1].endMs : 0 });
  }
  if (job && method === 'DELETE' && !job[2]) return json(jobs.delete(job[1]) ? 204 : 404, undefined);
  const file = path.match(/^\/v1\/files\/([^/]+)$/);
  if (file && method === 'DELETE') return json(files.delete(file[1]) ? 204 : 404, undefined);
  return refuse(404, 'not_found', `The fake has no ${method} ${path}.`);
}

module.exports = {
  /** The service's id in the app's line-up: the fake the tests reach for when Soniox transcribes. */
  name: 'soniox',
  handles: (url) => /^api(\.[a-z]+)?\.soniox\.com$/.test(url.hostname) && /^\/v1\/(files|transcriptions)(\/|$)/.test(url.pathname),
  answer,
  control,
};
