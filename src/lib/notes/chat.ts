// src/lib/notes/chat.ts
//
// The notes model is asked through a chat port: a system prompt, the user's part as compact JSON, and a JSON object
// back. `openAiChat` is that port over an OpenAI-compatible chat interface, called with the user's own key. A rate
// limit is waited out the way the measuring scripts did (15 s, then 30, 45, 60); anything else the service refuses
// comes back as a ChatError carrying the service's own message, for the user to read.

export type ChatEffort = 'none' | 'medium';

export interface ChatRequest {
  system: string;
  user: unknown;
  effort: ChatEffort;
  maxTokens: number;
  signal: AbortSignal;
  /** Each answer the service gave, with its request id when it names one (a hosted relay bills by these). */
  onAnswered?(info: { requestId?: string }): void;
}

/** Resolves to the model's answer, parsed: always a JSON object. */
export type ChatPort = (r: ChatRequest) => Promise<unknown>;

/** Refusals another try cannot fix: a bad request, a wrong or missing key, no access, no such model. */
const FINAL_STATUSES = new Set([400, 401, 403, 404]);

export class ChatError extends Error {
  readonly status?: number;
  readonly serviceMessage?: string;
  /** The program's own reason when the service gave none: `not-json`, `no-answer`, `no-topics`. */
  readonly code?: string;
  /** Whether trying again can help. */
  readonly retryable: boolean;

  constructor(message: string, o: { status?: number; serviceMessage?: string; code?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ChatError';
    this.status = o.status;
    this.serviceMessage = o.serviceMessage;
    this.code = o.code;
    this.retryable = o.retryable ?? !(o.status !== undefined && FINAL_STATUSES.has(o.status));
  }
}

/** A rate limit is waited out this long times the attempt, at most this many times. */
const RATE_LIMIT_WAIT_MS = 15_000;
const RATE_LIMIT_WAITS = 4;

const abortError = () => new DOMException('The notes request was cancelled', 'AbortError');

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

/** The service's own words about a refusal, and its error code or type. */
const refusalOf = async (response: Response): Promise<{ message?: string; code?: string }> => {
  try {
    const error = ((await response.json()) as { error?: { message?: unknown; code?: unknown; type?: unknown } })?.error;
    const code = typeof error?.code === 'string' ? error.code : typeof error?.type === 'string' ? error.type : undefined;
    return { message: typeof error?.message === 'string' ? error.message : undefined, code };
  } catch {
    return {};
  }
};

/** The notes models the settings offer: the newest OpenAI series, Luna (the one the passes were measured with) first. */
export const NOTES_MODELS = ['gpt-6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra'] as const;
/** Listed models that refuse `reasoning_effort: 'none'` (as tried on the service): they get their lowest, 'low'. */
const REFUSE_NONE: readonly string[] = ['gpt-6-astra', 'gpt-6.1-sol'];

/**
 * Models that take a `reasoning_effort`: GPT-5.1 and later. Any other model is sent none, and uses its own default: an
 * older reasoning model refuses 'none', a model without reasoning refuses the field at all, and a refused request is
 * not retried.
 */
export function takesReasoningEffort(model: string): boolean {
  return /^gpt-(?:5\.[1-9]\d*|[6-9]|\d{2,})(?:[.-]|$)/.test(model);
}

/** The `reasoning_effort` sent to `model` for `effort`, or null for none. */
function effortFor(model: string, effort: ChatEffort): ChatEffort | 'low' | null {
  if (!takesReasoningEffort(model)) return null;
  const refusesNone = REFUSE_NONE.some((m) => model === m || model.startsWith(`${m}-`));
  return effort === 'none' && refusesNone ? 'low' : effort;
}

export function openAiChat(o: { baseUrl: string; apiKey: string; model: string; fetch?: typeof fetch }): ChatPort {
  const send = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const url = `${o.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return async ({ system, user, effort, maxTokens, signal, onAnswered }) => {
    const reasoning = effortFor(o.model, effort);
    const body = JSON.stringify({
      model: o.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: maxTokens,
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
    });
    for (let waited = 0; ; ) {
      const response = await send(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}` },
        body,
        signal,
      });
      const requestId = response.headers.get('x-request-id');
      onAnswered?.(requestId ? { requestId } : {});
      if (!response.ok) {
        const refusal = await refusalOf(response);
        // Out of credit also comes as 429, and no wait helps it.
        const noCredit = refusal.code === 'insufficient_quota';
        if (response.status === 429 && !noCredit && waited < RATE_LIMIT_WAITS) {
          waited += 1;
          await wait(RATE_LIMIT_WAIT_MS * waited, signal);
          continue;
        }
        throw new ChatError(`The notes model refused the request (${response.status})`, {
          status: response.status, serviceMessage: refusal.message, ...(noCredit ? { retryable: false } : {}),
        });
      }
      let content: unknown;
      try {
        content = ((await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
      } catch {
        content = undefined;
      }
      if (typeof content !== 'string') throw new ChatError('The notes model gave no answer', { code: 'no-answer' });
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new ChatError('The notes model answered with something other than JSON', { code: 'not-json' });
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ChatError('The notes model answered with something other than a JSON object', { code: 'not-json' });
      }
      return parsed;
    }
  };
}
