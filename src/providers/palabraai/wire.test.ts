import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { redact } from '../../lib/diagnostics/redact';
import {
  CREATE_SESSION_BODY, CREATE_SESSION_URL, decodeMessage, directUrl, errorCode, errorOf, errorWords, GET_TASK, inputAudio, outputAudioOf, PALABRA_API,
  POLICY_VIOLATION, readCreated, restHeaders, restWords, sessionDeleteUrl, SESSIONS_URL, sessionUrl, setTask, taskStatusOf, transcriptionOf, validationWords,
  warningOf,
} from './wire';
import { APP, AUTO_CTX, configFor, CREATED_BODY, EN, JA, KEY, PUBLISHER, SENTENCE, SERVER, SESSION_ID, SESSION_WS_URL } from './testing';

/**
 * The names a credential is read through: the credentials' type, its three
 * fields, a REST session's publisher token, and the session type that holds
 * it and the socket address (fix round 1, M1) — a reader typed on
 * `CreatedSession` alone, naming neither `publisher` nor `id`, is still
 * caught by its parameter's or return type's own identifier.
 */
const SECRET_NAMES = new Set(['PalabraCredentials', 'CreatedSession', 'apiKey', 'clientId', 'clientSecret', 'publisher']);

/** The functions of a module that name a credential, `<module>` for a use outside any function; an import, or a type declared, names nothing. */
function secretReaders(source: string): string[] {
  const readers = new Set<string>();
  const enclosing = (node: ts.Node): string => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
    }
    return '<module>';
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isInterfaceDeclaration(node)) return;
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && SECRET_NAMES.has(node.text)) readers.add(enclosing(node));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true));
  return [...readers].sort();
}

const parse = (frame: string) => decodeMessage(frame);

describe("Palabra AI's wire: the two ways in (ruling 1)", () => {
  it('sends the platform key as a Bearer token and the app pair as its two headers', () => {
    expect(restHeaders(KEY)).toEqual({ Authorization: `Bearer ${KEY.apiKey}` });
    expect(restHeaders(APP)).toEqual({ ClientId: APP.clientId, ClientSecret: APP.clientSecret });
  });

  it("dials the platform key straight to the streaming endpoint, the key in the query, as the owner's probe did", () => {
    const url = directUrl('4593a7584de94538900fe318b855be17', KEY);
    expect(url).toBe(`wss://streaming.palabra.ai/streaming-api/4593a7584de94538900fe318b855be17/v1/speech-to-speech/stream?token=${KEY.apiKey}`);
    expect(directUrl('h', { kind: 'apiKey', apiKey: 'a b&c' })).toBe('wss://streaming.palabra.ai/streaming-api/h/v1/speech-to-speech/stream?token=a%20b%26c');
    // Wherever it lands, the carrier masks it.
    expect(redact(url)).not.toContain(KEY.apiKey);
  });

  it("creates a session for the app pair, and reaches its own address with the publisher token in the query", () => {
    expect(CREATE_SESSION_URL).toBe(`${PALABRA_API}/session-storage/session`);
    expect(JSON.parse(CREATE_SESSION_BODY)).toEqual({ data: { intent: 'api' } });
    const created = readCreated(CREATED_BODY);
    expect(created).toEqual({ id: SESSION_ID, publisher: PUBLISHER, wsUrl: SESSION_WS_URL });
    expect(sessionUrl(created!)).toBe(`${SESSION_WS_URL}?token=${PUBLISHER}`);
    expect(redact(sessionUrl(created!))).not.toContain(PUBLISHER);
    // Its own id alone is deleted — the id, too, is JWT-shaped, and masked wherever it lands.
    expect(sessionDeleteUrl(SESSION_ID)).toBe(`${SESSIONS_URL}/${SESSION_ID}`);
    expect(redact(SESSION_ID)).toBe('[REDACTED]');
    // An id holding a reserved character is still encoded (fix round 1, N2): a JWT needs none, so the encoding step went unexercised.
    expect(sessionDeleteUrl('a b&c')).toBe(`${SESSIONS_URL}/a%20b%26c`);
  });

  it('reads no session from an answer without a socket to reach', () => {
    expect(readCreated({ data: { id: 'x', publisher: 'y' } })).toBeNull();
    expect(readCreated({ errors: [] })).toBeNull();
    expect(readCreated(null)).toBeNull();
  });

  it("words a REST refusal in Palabra's own words: its detail, else its title, else ours", () => {
    expect(restWords(401, { errors: [{ title: 'Unauthorized', detail: 'Invalid credentials.' }] }, 'x')).toBe('HTTP 401: Invalid credentials.');
    expect(restWords(403, { errors: [{ title: 'Forbidden resource' }] }, 'x')).toBe('HTTP 403: Forbidden resource');
    expect(restWords(401, {}, 'Palabra did not accept these credentials.')).toBe('HTTP 401: Palabra did not accept these credentials.');
  });

  it('reads a credential in `wire.ts` in the four builders alone', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['directUrl', 'readCreated', 'restHeaders', 'sessionUrl']);
    // The scan's control: a read anywhere else is named — in a function, an arrow, at the top level, or indexed; an import or an interface is not.
    expect(secretReaders([
      "import type { PalabraCredentials } from './settings';",
      'interface Held { publisher: string }',
      'export function url(k: PalabraCredentials) { return k.kind; }',
      'export const frame = (k: { apiKey: string }) => k.apiKey;',
      "const leaked = { clientSecret: 'x' };",
      "export function indexed(k: Record<string, string>) { return k['clientId']; }",
    ].join('\n'))).toEqual(['<module>', 'frame', 'indexed', 'url']);
  });

  it('reads a credential through a function typed on the session alone, naming neither field (fix round 1, M1)', () => {
    // The review's own mutant: `id` and `wsUrl` are not secret names, but the parameter's `CreatedSession` type is.
    expect(secretReaders("export function sessionWords(c: CreatedSession): string { return `session ${c.id} at ${c.wsUrl}`; }")).toEqual(['sessionWords']);
  });
});

describe("Palabra AI's wire: the task", () => {
  it("configures a speaking leg as the owner's probe did: 24 kHz pcm both ways over this socket, timbre detection off (rulings 7, 10)", () => {
    expect(setTask(configFor())).toEqual({
      message_type: 'set_task',
      data: {
        input_stream: { content_type: 'audio', source: { type: 'ws', format: 'pcm_s16le', sample_rate: 24_000, channels: 1 } },
        output_stream: { content_type: 'audio', target: { type: 'ws', format: 'pcm_s16le' } },
        pipeline: {
          transcription: { source_language: 'ja', detectable_languages: [], segment_confirmation_silence_threshold: 0.7, sentence_splitter: { enabled: true } },
          translations: [{
            target_language: 'en',
            translate_partial_transcriptions: false,
            speech_generation: { voice_cloning: false, voice_id: 'default_low', voice_timbre_detection: { enabled: false, high_timbre_voices: ['default_high'], low_timbre_voices: ['default_low'] } },
          }],
          translation_queue_configs: { global: { desired_queue_level_ms: 8_000, max_queue_level_ms: 24_000, auto_tempo: false } },
          allowed_message_types: ['translated_transcription', 'partial_transcription', 'partial_translated_transcription', 'validated_transcription'],
        },
      },
    });
  });

  it('asks for text alone on a leg that does not speak (ruling 7), and sends the settings as built', () => {
    expect(setTask(configFor({ ...AUTO_CTX, speech: false })).data.output_stream).toBeNull();
    const c = configFor(AUTO_CTX, { voiceId: 'default_high', segmentConfirmationSilenceThreshold: 1.2, sentenceSplitterEnabled: false, translatePartialTranscriptions: true, desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000, autoTempo: true });
    const { pipeline } = setTask(c).data;
    expect(pipeline.transcription).toMatchObject({ segment_confirmation_silence_threshold: 1.2, sentence_splitter: { enabled: false } });
    expect(pipeline.translations[0]).toMatchObject({ translate_partial_transcriptions: true, speech_generation: { voice_id: 'default_high', voice_timbre_detection: { enabled: false } } });
    expect(pipeline.translation_queue_configs.global).toEqual({ desired_queue_level_ms: 15_000, max_queue_level_ms: 18_000, auto_tempo: true });
  });

  it('asks for the task as the probe did, and sends a chunk as base64 pcm', () => {
    expect(GET_TASK).toEqual({ message_type: 'get_task', data: { exclude_hidden: true } });
    const pcm = new Int16Array(7_680).map((_, i) => (i % 200) - 100);
    const frame = JSON.parse(inputAudio(pcm)) as { message_type: string; data: { data: string } };
    expect(frame.message_type).toBe('input_audio_data');
    expect(frame.data.data).toHaveLength(20_480);
    expect(Array.from(base64ToPcm(frame.data.data))).toEqual(Array.from(pcm));
  });
});

describe("Palabra AI's wire: the server's messages", () => {
  it('reads a text frame, a binary one, and a data field sent as JSON text', () => {
    expect(parse(SERVER.currentTask())).toMatchObject({ type: 'current_task', data: { task_status: 'running' } });
    expect(decodeMessage(new TextEncoder().encode(SERVER.endOfStream()).buffer)).toEqual({ type: 'end_of_stream', data: {} });
    expect(parse(SERVER.doubleEncoded('current_task', { task_status: 'paused' }))).toEqual({ type: 'current_task', data: { task_status: 'paused' } });
    expect(parse(JSON.stringify({ message_type: 'x', data: 'not json' }))).toEqual({ type: 'x', data: {} });
    expect(parse(JSON.stringify({ message_type: 'x' }))).toEqual({ type: 'x', data: {} });
  });

  it('throws on a frame that is no JSON object with a message_type', () => {
    for (const bad of ['not json', '[]', 'null', JSON.stringify({ data: {} }), JSON.stringify({ message_type: 7 })]) expect(() => decodeMessage(bad), bad).toThrow();
    expect(() => decodeMessage(new Blob(['{}']))).toThrow('a server frame of an unexpected kind');
  });

  it("reads a transcription as the probe logged it, the part a string whether it came as one or as a number", () => {
    expect(transcriptionOf(parse(SERVER.partial('リアルタイム', SENTENCE, 1.22)).data)).toEqual({ id: SENTENCE, part: undefined, language: 'ja', text: 'リアルタイム', start: 0.32, end: 1.22 });
    expect(transcriptionOf(parse(SERVER.validated()).data)).toMatchObject({ id: SENTENCE, text: JA });
    expect(transcriptionOf(parse(SERVER.translated()).data)).toMatchObject({ id: SENTENCE, part: '0', language: 'en', text: EN });
    expect(transcriptionOf({})).toEqual({ id: undefined, part: undefined, language: undefined, text: '', start: undefined, end: undefined });
  });

  it('reads a chunk of speech, its part as a string and its last flag', () => {
    const audio = outputAudioOf(parse(SERVER.audio({ last: true, samples: 2_859 })).data);
    expect(audio).toMatchObject({ id: SENTENCE, part: '0', last: true });
    expect(base64ToPcm(audio.audio as string)).toHaveLength(2_859);
    expect(outputAudioOf(parse(SERVER.audio({ part: 1 })).data)).toMatchObject({ part: '1', last: false });
  });

  it('reads an error, a warning and a task status', () => {
    expect(errorOf(parse(SERVER.notFound()).data)).toEqual({ code: 'NOT_FOUND', desc: 'No active task found', msg: undefined, param: null });
    expect(warningOf(parse(SERVER.voiceNotFound()).data)).toEqual({ code: 'VOICE_NOT_FOUND', message: "Voice ID 'default_low' is not available, using default voice" });
    expect(taskStatusOf(parse(SERVER.currentTask('paused')).data)).toBe('paused');
    expect(taskStatusOf({})).toBeUndefined();
  });

  it("words the probe's refusals by the field and its message, from the `desc` a pydantic error carries (ruling 4)", () => {
    const threshold = errorOf(parse(SERVER.thresholdRefused()).data);
    expect(validationWords(threshold.desc)).toBe('segment_confirmation_silence_threshold: ensure this value is greater than or equal to 0.3');
    expect(errorWords(threshold)).toBe('[Palabra VALIDATION_ERROR] segment_confirmation_silence_threshold: ensure this value is greater than or equal to 0.3');
    expect(errorWords(errorOf(parse(SERVER.queueRefused()).data))).toBe('[Palabra VALIDATION_ERROR] global: `max_queue_level_ms` must be greater than `desired_queue_level_ms`');
    // A message holding an apostrophe is quoted with double quotes in Python's repr.
    expect(validationWords(`ValidationError(model='M', errors=[{'loc': ('a', 'b'), 'msg': "value isn't valid", 'type': 't'}, {'loc': ('c',), 'msg': 'second', 'type': 't'}])`)).toBe("b: value isn't valid; c: second");
  });

  it('falls back to the message, then the whole desc, then words of its own', () => {
    expect(errorWords(errorOf(parse(SERVER.serviceTimeout()).data))).toBe('[Palabra SERVICE_TIMEOUT] No input audio received for 10s. Use the pause_task command for intentional pauses.');
    expect(errorWords({ code: 'X', msg: 'from msg', desc: 'no pydantic here' })).toBe('[Palabra X] from msg');
    expect(errorWords({})).toBe('[Palabra error] the server reported an error');
  });

  it("puts a refused task as the request's, anything else as the service's", () => {
    expect(errorCode({ code: 'VALIDATION_ERROR' })).toBe('client');
    expect(errorCode({ code: 'SERVICE_TIMEOUT' })).toBe('server');
    expect(errorCode({})).toBe('server');
    expect(POLICY_VIOLATION).toBe(1008);
  });
});
