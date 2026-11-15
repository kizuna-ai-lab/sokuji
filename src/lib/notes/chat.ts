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
}

/** Resolves to the model's answer, parsed: always a JSON object. */
export type ChatPort = (r: ChatRequest) => Promise<unknown>;

export class ChatError extends Error {
  readonly status?: number;
  readonly serviceMessage?: string;

  constructor(message: string, o: { status?: number; serviceMessage?: string } = {}) {
    super(message);
    this.name = 'ChatError';
    this.status = o.status;
    this.serviceMessage = o.serviceMessage;
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

const serviceMessageOf = async (response: Response): Promise<string | undefined> => {
  try {
    const message = ((await response.json()) as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' ? message : undefined;
  } catch {
    return undefined;
  }
};

export function openAiChat(o: { baseUrl: string; apiKey: string; model: string; fetch?: typeof fetch }): ChatPort {
  const send = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const url = `${o.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return async ({ system, user, effort, maxTokens, signal }) => {
    const body = JSON.stringify({
      model: o.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: maxTokens,
      reasoning_effort: effort,
    });
    for (let waited = 0; ; ) {
      const response = await send(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}` },
        body,
        signal,
      });
      if (response.status === 429 && waited < RATE_LIMIT_WAITS) {
        waited += 1;
        await wait(RATE_LIMIT_WAIT_MS * waited, signal);
        continue;
      }
      if (!response.ok) {
        const serviceMessage = await serviceMessageOf(response);
        throw new ChatError(`The notes model refused the request (${response.status})`, { status: response.status, serviceMessage });
      }
      let content: unknown;
      try {
        content = ((await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
      } catch {
        content = undefined;
      }
      if (typeof content !== 'string') throw new ChatError('The notes model gave no answer');
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new ChatError('The notes model answered with something other than JSON');
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ChatError('The notes model answered with something other than a JSON object');
      }
      return parsed;
    }
  };
}
