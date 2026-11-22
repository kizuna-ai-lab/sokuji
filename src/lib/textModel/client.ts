// src/lib/textModel/client.ts
//
// The text-model client: one non-streaming chat completion, a model list, and a probe of one model, over the
// OpenAI chat-completions protocol that all three services speak. OpenAI and Gemini (its OpenAI-compatible endpoint)
// are asked from the page with the user's key as a bearer token; a compatible service the user names is asked from
// the desktop app's main process (`desktopTransport.ts`), which a third-party server's missing CORS answer cannot
// stop.
//
// Every refusal comes back as a typed failure carrying the service's own words, trimmed, never the key. Nothing is
// waited out here: a rate limit is a failure at once, for the caller to judge. A caller's abort rejects with the
// caller's reason, unless the caller marks it as a timeout (`textModelTimeout()`): that is a `timeout` failure.

import { compatibleAddressProblem, normaliseBaseUrl, type AddressProblem } from './address';
import { platformTextModelTransport } from './desktopTransport';
import { lowestReasoningEffort } from './reasoning';

export type TextModelService = 'openai' | 'gemini' | 'compatible';

export type TextModelFailureCode = 'auth' | 'model_missing' | 'rate_limit' | 'quota' | 'server' | 'network' | 'timeout' | 'refused';

/** Why a request had no answer: a code, the HTTP status when the service answered, and the service's own words. */
export interface TextModelFailure {
  code: TextModelFailureCode;
  status?: number;
  message: string;
  /** The model ran and spent its budget before its first word: read from the service's words before a key was taken out of them. */
  cutShort?: true;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface TextModelRequestInit { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal }
/** What a transport hands back: the status and the body, as text. */
export interface TextModelAnswer { status: number; text(): Promise<string> }
/** Sends one request. A transport that cannot send says why with a `TextModelTransportError`; anything else it throws is `network`. */
export type TextModelTransport = (url: string, init: TextModelRequestInit) => Promise<TextModelAnswer>;

/** A transport's own failure, with the code the client answers it with. */
export class TextModelTransportError extends Error {
  readonly code: TextModelFailureCode;

  constructor(code: TextModelFailureCode, message: string) {
    super(message);
    this.name = 'TextModelTransportError';
    this.code = code;
  }
}

export const OPENAI_TEXT_BASE_URL = 'https://api.openai.com/v1';
/** Gemini's OpenAI-compatible endpoint: the same body shape, the key as a bearer token. */
export const GEMINI_TEXT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** The reason a caller aborts with to say the request ran out of time: the client then answers `timeout`. */
export function textModelTimeout(message = 'The service did not answer in time.'): DOMException {
  return new DOMException(message, 'TimeoutError');
}

/**
 * What a service was found to refuse for one model, kept by the caller across its calls (one per session, say) so
 * that a refusal is met once, not on every request. The client reads it and writes what it learns.
 */
export interface TextModelMemo {
  /** The `reasoning_effort` the model took for the lowest, or null: it takes none. Absent: not learned yet. */
  reasoningEffort?: string | null;
  /**
   * What each stage default (`{ preferred }`) was lowered to, by the value asked: a lower one, or null for none.
   * Absent for a value: it was taken as it is, or never asked. Apart from the lowest's: neither reads the other's.
   */
  preferredEffort?: Record<string, string | null>;
  /** False: the service refuses `response_format`. Absent: not learned yet. */
  responseFormat?: boolean;
}

interface Where {
  service: TextModelService;
  /** A compatible service's address. OpenAI and Gemini are always sent to their own endpoints, whatever this says. */
  baseUrl?: string;
  /** Absent: no `Authorization` is sent (a compatible service on this computer may need none). */
  apiKey?: string;
  signal: AbortSignal;
  /** Absent: the page's `fetch` for OpenAI and Gemini, the desktop app's main process for a compatible service. */
  transport?: TextModelTransport;
}

export interface ChatCompletionOptions extends Where {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Ask for a JSON object. A compatible service or Gemini that refuses the member is asked once more without it. */
  json?: boolean;
  temperature?: number;
  /**
   * 'lowest' (the default): the least reasoning the model takes (`lowestReasoningEffort`), so a short answer is not
   * spent on reasoning. 'default': no `reasoning_effort`, the service's own default. `{ exact }`: the user's choice,
   * sent as it is; a refusal of it is the answer, never asked again with another value. `{ preferred }`: a stage's
   * own default (the notes'), sent as it is and lowered as the lowest is where the model refuses it.
   */
  reasoning?: ReasoningAsk;
  /** What this model was found to refuse, kept across calls. */
  memo?: TextModelMemo;
}

/**
 * How much reasoning to ask of a model. 'lowest': the least it takes, lowered further when the service refuses a
 * value (what is learned goes in the memo). 'default': no `reasoning_effort`. `{ exact }`: this value and no other.
 * `{ preferred }`: this value where the model takes it, else 'low', else none (the memo keeps what it was lowered to).
 */
export type ReasoningAsk = 'lowest' | 'default' | { exact: string } | { preferred: string };

/** `id`: the service's own id for the completion, where its answer names one. */
export type ChatCompletionResult = { ok: true; text: string; id?: string } | { ok: false; failure: TextModelFailure };
export type ListModelsResult = { ok: true; ids: string[] } | { ok: false; failure: TextModelFailure };
export type ProbeResult = { ok: true } | { ok: false; failure: TextModelFailure };

/** Why a compatible service's address cannot be used, in words: the client's refusal, and the credentials' `read`. */
export const ADDRESS_WORDS: Readonly<Record<AddressProblem | 'missing', string>> = {
  missing: 'No address was given for the compatible service.',
  not_a_url: 'The address is not a web address.',
  not_https: 'The address must start with https:// (http:// only for this computer).',
  has_credentials: 'The address must not hold a name or a password: the key has a field of its own.',
  has_query: 'The address must not hold a query or a fragment (? or #).',
};

/** The longest message a failure carries: a service's page of text is cut. */
const MESSAGE_LIMIT = 500;

const fetchTransport: TextModelTransport = (url, init) => fetch(url, init);

/** The service's words, trimmed and cut, with the key taken out should it ever be in them. */
function spoken(text: string, apiKey: string | undefined): string {
  // Any key, however short: a compatible service's key may be a few characters, and is never to be shown.
  const scrubbed = apiKey ? text.split(apiKey).join('[key]') : text;
  const trimmed = scrubbed.trim();
  return trimmed.length > MESSAGE_LIMIT ? `${trimmed.slice(0, MESSAGE_LIMIT - 1)}…` : trimmed;
}

const failed = (code: TextModelFailureCode, message: string, status?: number): { ok: false; failure: TextModelFailure } => ({
  ok: false, failure: { code, ...(status === undefined ? {} : { status }), message },
});

/** The base the request goes to, and how it is sent; or why it cannot be sent at all. */
function routeOf(o: Where): { base: string; transport: TextModelTransport } | { ok: false; failure: TextModelFailure } {
  if (o.service === 'openai') return { base: OPENAI_TEXT_BASE_URL, transport: o.transport ?? fetchTransport };
  if (o.service === 'gemini') return { base: GEMINI_TEXT_BASE_URL, transport: o.transport ?? fetchTransport };
  if (o.baseUrl === undefined || o.baseUrl.trim() === '') return failed('refused', ADDRESS_WORDS.missing);
  const problem = compatibleAddressProblem(o.baseUrl);
  if (problem) return failed('refused', ADDRESS_WORDS[problem]);
  const transport = o.transport ?? platformTextModelTransport();
  if (!transport) return failed('refused', 'A compatible service can be reached from the desktop app only.');
  return { base: normaliseBaseUrl(o.baseUrl), transport };
}

/** The caller aborted: a timeout it marked is a failure; any other abort rejects with its reason. */
function aborted(signal: AbortSignal, apiKey: string | undefined): { ok: false; failure: TextModelFailure } {
  const reason: unknown = signal.reason;
  // Read by its name, not its class: a DOMException may come from another realm (a worker's, a test environment's).
  const named = typeof reason === 'object' && reason !== null ? (reason as { name?: unknown; message?: unknown }) : null;
  if (named?.name === 'TimeoutError') {
    return failed('timeout', spoken(typeof named.message === 'string' && named.message !== '' ? named.message : 'The service did not answer in time.', apiKey));
  }
  throw reason ?? new DOMException('The request was cancelled.', 'AbortError');
}

/** One request: the status and the body; or a failure with no answer (nothing reached, or the transport's own). */
async function send(
  transport: TextModelTransport,
  url: string,
  init: Omit<TextModelRequestInit, 'signal'>,
  o: Where,
): Promise<{ status: number; raw: string } | { ok: false; failure: TextModelFailure }> {
  const { signal, apiKey } = o;
  if (signal.aborted) return aborted(signal, apiKey);
  try {
    const answer = await transport(url, { ...init, signal });
    if (signal.aborted) return aborted(signal, apiKey);
    const raw = await answer.text();
    if (signal.aborted) return aborted(signal, apiKey);
    return { status: answer.status, raw };
  } catch (error) {
    if (signal.aborted) return aborted(signal, apiKey);
    if (error instanceof TextModelTransportError) return failed(error.code, spoken(error.message, apiKey));
    const words = error instanceof Error ? error.message : String(error);
    return failed('network', spoken(`The service could not be reached: ${words}`, apiKey));
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const stringOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** A refusal's words and its code, from the shapes services use: `{ error: {…} }`, `{ error: '…' }`, Gemini's `[{ error }]`. */
function refusalOf(raw: string): { message?: string; code?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Plain words are the service's own; a page of markup is not words.
    const text = raw.trim();
    return text !== '' && !text.startsWith('<') ? { message: text } : {};
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!isRecord(first)) return {};
  const error = first.error;
  if (typeof error === 'string') return { message: stringOf(error) };
  const body = isRecord(error) ? error : first;
  const code = stringOf(body.code) ?? stringOf(body.type);
  return { message: stringOf(body.message) ?? stringOf(body.detail), code };
}

/** A refusal that says the model is not one the service has (OpenAI, Gemini, DeepSeek, OpenRouter, Ollama words). */
const UNKNOWN_MODEL = [
  /\bmodels?\b(?:[^.,;:\n]|\.(?=\S)){0,80}?\b(?:not found|does not exist|not exist|is not available|no longer available)\b/i,
  /\b(?:unknown|invalid|no such|not a valid|nonexistent)\s+model\b/i,
];
/** A refusal of the key that comes as a 400 (Gemini's). */
// Gemini answers a refused key with a 400, not a 401: "Please pass a valid API key" (measured 2026-11-22).
const KEY_NOT_VALID = /api[ _]key not valid|invalid api[ _]key|valid api[ _]key|API_KEY_INVALID/i;

/** The failure a refusal is, in the service's own words. */
function refusedAs(status: number, raw: string, apiKey: string | undefined): { ok: false; failure: TextModelFailure } {
  const refusal = refusalOf(raw);
  const message = spoken(refusal.message ?? '', apiKey) || `The service answered ${status}.`;
  const said = refusal.message ?? '';
  if (status === 401 || status === 403) return failed('auth', message, status);
  if (status === 402) return failed('quota', message, status);
  if (status === 429) return failed(refusal.code === 'insufficient_quota' ? 'quota' : 'rate_limit', message, status);
  if (status >= 500) return failed('server', message, status);
  if (status === 404 || refusal.code === 'model_not_found' || UNKNOWN_MODEL.some((re) => re.test(said))) return failed('model_missing', message, status);
  if (KEY_NOT_VALID.test(said) || refusal.code === 'API_KEY_INVALID') return failed('auth', message, status);
  // Read from the service's own words: taking a short key out of them may break a word the pattern needs.
  if (status === 400 && OUTPUT_LIMIT.test(said)) return { ok: false, failure: { code: 'refused', status, message, cutShort: true } };
  return failed('refused', message, status);
}

const headersOf = (apiKey: string | undefined, json: boolean): Record<string, string> => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
});

/** The model's answer from a completion: its text, a refusal to answer, or an answer that cannot be read. */
function answerOf(raw: string, apiKey: string | undefined): ChatCompletionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failed('server', "The service's answer could not be read.");
  }
  if (!isRecord(parsed)) return failed('server', "The service's answer could not be read.");
  const choices = parsed.choices;
  if (!Array.isArray(choices)) {
    const refusal = refusalOf(raw);
    return failed('server', spoken(refusal.message ?? '', apiKey) || "The service's answer held no choices.");
  }
  const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {};
  const { content } = message;
  const id = stringOf(parsed.id);
  const answered = (text: string): ChatCompletionResult => (id === undefined ? { ok: true, text } : { ok: true, text, id });
  if (typeof content === 'string') return answered(content);
  if (Array.isArray(content)) {
    return answered(content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join(''));
  }
  const refusal = stringOf(message.refusal);
  if (refusal) return failed('refused', spoken(refusal, apiKey));
  return answered('');
}

const REASONING_NAMED = /reasoning[_.]effort/i;
const FORMAT_NAMED = /response_format/i;

/**
 * One chat completion. The answer's text as the model gave it (possibly empty), or a failure. A 400 that names
 * `reasoning_effort` is asked again with 'low', then without it; one that names `response_format` (Gemini, a
 * compatible service) once without it. Nothing else is asked twice.
 */
export async function chatCompletion(o: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const route = routeOf(o);
  if ('ok' in route) return route;
  const { memo } = o;
  const url = `${route.base}/chat/completions`;
  const exact = typeof o.reasoning === 'object' && 'exact' in o.reasoning ? o.reasoning.exact : undefined;
  const preferred = typeof o.reasoning === 'object' && 'preferred' in o.reasoning ? o.reasoning.preferred : undefined;
  // Learned only for the lowest: a value the user chose is sent as it is, and a default is no value at all.
  const learns = o.reasoning === undefined || o.reasoning === 'lowest';
  // Lowered where refused: the lowest, and a stage's own default.
  const lowers = learns || preferred !== undefined;
  let effort: string | null = exact !== undefined
    ? exact
    : preferred !== undefined
      // A default lowered before in this session is asked at what it was lowered to.
      ? (memo?.preferredEffort?.[preferred] !== undefined ? memo.preferredEffort[preferred] : preferred)
      : o.reasoning === 'default'
        ? null
        : memo?.reasoningEffort !== undefined ? memo.reasoningEffort : lowestReasoningEffort(o.service, o.model);
  let json = o.json === true && memo?.responseFormat !== false;
  let effortRetries = 0;
  /** 'low' was refused on the way down: kept for every default of the session. */
  let lowRefused = false;
  let formatRetried = false;
  for (;;) {
    const body = JSON.stringify({
      model: o.model,
      messages: o.messages,
      ...(o.service === 'openai' ? { max_completion_tokens: o.maxTokens } : { max_tokens: o.maxTokens }),
      ...(effort === null ? {} : { reasoning_effort: effort }),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...(o.temperature === undefined ? {} : { temperature: o.temperature }),
    });
    const sent = await send(route.transport, url, { method: 'POST', headers: headersOf(o.apiKey, true), body }, o);
    if ('ok' in sent) return sent;
    const { status, raw } = sent;
    if (status >= 200 && status < 300) {
      if (memo && learns) memo.reasoningEffort = effort;
      // A default lowered is kept at what it was lowered to, and a 'low' refused on the way as refused; one taken as it
      // is says nothing of another.
      if (memo && preferred !== undefined && (effort !== preferred || lowRefused)) {
        memo.preferredEffort = { ...memo.preferredEffort, ...(lowRefused ? { low: null } : {}), [preferred]: effort };
      }
      if (memo && o.json === true) memo.responseFormat = json;
      return answerOf(raw, o.apiKey);
    }
    if (status === 400 && lowers && effort !== null && effortRetries < 2 && REASONING_NAMED.test(raw)) {
      // A default lowered from above 'low' goes where 'low' itself was found to go, when that is known.
      const low = preferred !== undefined && memo?.preferredEffort?.low !== undefined ? memo.preferredEffort.low : 'low';
      if (effort === 'low') lowRefused = true;
      effort = effort === 'low' ? null : low;
      effortRetries += 1;
      continue;
    }
    if (status === 400 && json && o.service !== 'openai' && !formatRetried && FORMAT_NAMED.test(raw)) {
      json = false;
      formatRetried = true;
      continue;
    }
    return refusedAs(status, raw, o.apiKey);
  }
}

/**
 * The service's model ids, from `GET …/models` (`data[].id`), Gemini's without their `models/` prefix, each once.
 * A compatible service with no list (404) lists nothing, which is no failure: the user types the model. A listed
 * model may still be refused at use (`probeModel`).
 */
export async function listModels(o: Where): Promise<ListModelsResult> {
  const route = routeOf(o);
  if ('ok' in route) return route;
  const sent = await send(route.transport, `${route.base}/models`, { method: 'GET', headers: headersOf(o.apiKey, false) }, o);
  if ('ok' in sent) return sent;
  const { status, raw } = sent;
  if (status === 404 && o.service === 'compatible') return { ok: true, ids: [] };
  if (status === 404) return failed('refused', spoken(refusalOf(raw).message ?? '', o.apiKey) || 'The service answered 404.', 404);
  if (status < 200 || status >= 300) return refusedAs(status, raw, o.apiKey);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const data = isRecord(parsed) ? parsed.data : undefined;
  if (!Array.isArray(data)) return failed('server', "The service's answer is not a list of models.");
  const ids = data
    .map((entry) => (isRecord(entry) && typeof entry.id === 'string' ? (o.service === 'gemini' ? entry.id.replace(/^models\//, '') : entry.id) : ''))
    .filter((id) => id !== '');
  return { ok: true, ids: [...new Set(ids)] };
}

/**
 * Whether `model` answers at all: a chat completion of a few tokens, with the lowest reasoning or the reasoning the
 * user chose. A model the service lists may still be refused (Gemini lists models no longer open to new keys), and a
 * reasoning value the user typed may be one the model refuses; this is how a check finds out, in the service's words.
 */
export async function probeModel(o: Where & { model: string; memo?: TextModelMemo; reasoning?: Exclude<ReasoningAsk, 'default'> }): Promise<ProbeResult> {
  const result = await chatCompletion({ ...o, messages: [{ role: 'user', content: 'Hi' }], maxTokens: PROBE_TOKENS, reasoning: o.reasoning ?? 'lowest' });
  if (result.ok) return { ok: true };
  // A reasoning model may spend the whole budget before its first word: OpenAI then refuses the answer as cut
  // short (measured 2026-11-22, gpt-5-mini). It was reached and it ran: that is all a probe asks.
  if (result.failure.cutShort) return { ok: true };
  return result;
}

/** The probe's budget: a few tokens, so that a model which reasons a little first still answers. */
export const PROBE_TOKENS = 16;
const OUTPUT_LIMIT = /max_tokens or model output limit|output limit was reached/i;

/**
 * The JSON object in a model's answer: the whole text, a fenced block, or the outermost braces among other words
 * (a service that took no `response_format` may wrap its JSON). Null when there is none.
 */
export function jsonObjectOf(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [text, fenced?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const candidate of candidates) {
    if (!candidate || candidate.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // The next way of reading it.
    }
  }
  return null;
}
