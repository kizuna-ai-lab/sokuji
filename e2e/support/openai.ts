import type { Route } from '@playwright/test';
import type { Sokuji } from './app';

/** One request the app sent to OpenAI: the path under /v1 and its JSON body (null for a GET). */
export interface OpenAiRequest {
  path: string;
  body: Record<string, unknown> | null;
}

/** What to answer a chat request with: a JSON object for the model's answer, or a refusal. */
export type ChatAnswer =
  | { answer: Record<string, unknown> }
  | { status: number; message: string; code?: string }
  /** Never answers: the request stays open until the app gives up or the test ends. */
  | { hang: true };

export interface FakeOpenAi {
  /** Every request so far, in order. */
  requests: OpenAiRequest[];
  /** Replaces how chat requests are answered from now on. Default: `notesAnswer`. */
  answerChat(next: (request: OpenAiRequest) => ChatAnswer | Promise<ChatAnswer>): void;
  /** Whether the key check (GET /v1/models) passes. Default: it does. */
  acceptKey(accept: boolean): void;
  /** Errors thrown by the test's own `answerChat` handler; a spec can assert this stays empty. */
  failures: string[];
}

// `authorization` by name: a wildcard does not cover it in a preflight.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'x-request-id',
};

/** The sentence numbers a notes request carries, in order (its user message is compact JSON with `sentences`). */
export function sentenceIds(request: OpenAiRequest): number[] {
  const messages = (request.body?.messages ?? []) as Array<{ role?: string; content?: unknown }>;
  const user = messages.find((m) => m.role === 'user')?.content;
  try {
    const parsed = JSON.parse(String(user)) as { sentences?: Array<{ sid?: unknown }> };
    return (parsed.sentences ?? []).map((s) => Number(s.sid)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

/**
 * An answer every notes prompt accepts (a part, the finishing call, the names step): one topic that opens at the
 * request's first sentence, with one point at its second.
 */
export function notesAnswer(request: OpenAiRequest): ChatAnswer {
  const ids = sentenceIds(request);
  const first = ids[0] ?? 1;
  const second = ids[1] ?? first;
  return {
    answer: {
      title: 'Fake notes title', summary: 'Fake notes summary.',
      topics: [{ title: 'Fake topic', sid: first, summary: 'Fake topic summary.', points: [{ text: 'Fake point', sid: second, kinds: [] }] }],
      join: [], drop: [], merge: [], items: [],
    },
  };
}

/**
 * Answers the app's requests to api.openai.com from the test, in the page's own network layer: the app is not
 * changed and nothing leaves the machine. Notes are a plain chat-completions request, and the key check a GET of the
 * model list.
 */
export async function fakeOpenAi(sokuji: Sokuji): Promise<FakeOpenAi> {
  const requests: OpenAiRequest[] = [];
  let chat: (request: OpenAiRequest) => ChatAnswer | Promise<ChatAnswer> = notesAnswer;
  let keyAccepted = true;
  let served = 0;
  const failures: string[] = [];

  await sokuji.app.context().route('https://api.openai.com/**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(request.url()).pathname.replace(/^\/v1/, '');
    let body: Record<string, unknown> | null = null;
    try { body = request.postDataJSON() as Record<string, unknown> | null; } catch { body = null; }
    const seen = { path, body };
    requests.push(seen);
    const json = (status: number, payload: unknown) => route.fulfill({
      status, contentType: 'application/json', headers: { ...CORS, 'x-request-id': `req_e2e_${++served}` }, body: JSON.stringify(payload),
    });

    if (path === '/models') {
      return keyAccepted
        ? json(200, { object: 'list', data: [{ id: 'gpt-5.4-mini', object: 'model' }, { id: 'gpt-realtime', object: 'model' }] })
        : json(401, { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } });
    }
    if (path === '/chat/completions') {
      let next: ChatAnswer;
      try {
        next = await chat(seen);
      } catch (error) {
        // A mistake in the test's own handler: said out loud, not left to look like a service that never answers.
        failures.push(String(error));
        return json(500, { error: { message: `The test's answerChat handler threw: ${String(error)}`, type: 'server_error' } });
      }
      if ('hang' in next) return; // left unanswered on purpose
      if ('status' in next) return json(next.status, { error: { message: next.message, type: 'invalid_request_error', code: next.code ?? null } });
      return json(200, {
        id: 'chatcmpl-e2e', object: 'chat.completion', model: String(body?.model ?? 'fake'),
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(next.answer) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
    }
    return json(404, { error: { message: `The fake OpenAI has no answer for ${path}.`, type: 'invalid_request_error' } });
  });

  return {
    requests,
    failures,
    answerChat: (next) => { chat = next; },
    acceptKey: (accept) => { keyAccepted = accept; },
  };
}
