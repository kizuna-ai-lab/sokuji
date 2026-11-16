// src/lib/notes/relayChat.ts
//
// The notes written by Kizuna AI: the chat port over our relay (`POST <backend>/api/openai/chat/completions`). The body
// is byte for byte the one an own key sends (`chatBody`); only the address and the credential differ, and four headers
// say which meeting it is for, who pays, and which prompt and version it is (the relay puts in its own copy of that
// prompt). The relay's own refusals come in OpenAI's error shape and are read by their code.
import { abortError, answerOf, chatBody, ChatError, RATE_LIMIT_WAITS, refusalOf, wait, type ChatPort } from './chat';

/** The one model the relay writes notes with. */
export const RELAY_NOTES_MODEL = 'gpt-6-luna';

/** The relay's codes, as the notes name them; absent from the table: final, with the service's message. */
const FINAL_CODES: Readonly<Record<string, string>> = {
  no_balance: 'no-balance',
  daily_limit: 'daily-limit',
  not_signed_in: 'sign-in',
  wallet_frozen: 'wallet-frozen',
  not_org_member: 'not-member',
  request_too_large: 'too-large',
  update_required: 'update-required',
};
/** Codes another try can help with, after the usual waits. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set(['upstream_unavailable', 'balance_unavailable']);

export interface RelayChatOptions {
  /** The backend's address, without `/api`. */
  baseUrl: string;
  /** The user's sign-in token, or null when signed out. */
  token(): Promise<string | null>;
  /** The meeting the calls are for (its record id): the ledger groups by it. */
  sessionRef?: string;
  /** Who pays; absent: the backend's default (the organization of a member, else the person). */
  payer: 'personal' | 'organization' | undefined;
  /** The balance after each charge, in µUSD. */
  onBalance?(microUsd: number): void;
  fetch?: typeof fetch;
}

export function relayChat(o: RelayChatOptions): ChatPort {
  const send = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const url = `${o.baseUrl.replace(/\/+$/, '')}/api/openai/chat/completions`;

  return async (r) => {
    const token = await o.token();
    if (!token) throw new ChatError('Sign in to write notes with Kizuna AI', { code: 'sign-in', retryable: false });
    if (r.signal.aborted) throw abortError();
    const body = chatBody(RELAY_NOTES_MODEL, r);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Sokuji-Prompt': r.prompt,
      'X-Sokuji-Prompt-Version': String(r.promptVersion),
      ...(o.sessionRef ? { 'X-Sokuji-Session': o.sessionRef } : {}),
      ...(o.payer ? { 'X-Sokuji-Payer': o.payer } : {}),
    };
    for (let waited = 0; ; ) {
      const response = await send(url, { method: 'POST', headers, body, signal: r.signal });
      const balance = Number(response.headers.get('X-Sokuji-Balance-After'));
      if (response.headers.has('X-Sokuji-Balance-After') && Number.isFinite(balance)) o.onBalance?.(balance);
      if (response.ok) {
        // Read before the answer is: the body is consumed once.
        const copy = response.clone();
        let requestId: string | undefined;
        try {
          const id = ((await copy.json()) as { id?: unknown })?.id;
          if (typeof id === 'string') requestId = id;
        } catch { /* answerOf says what is wrong with it */ }
        r.onAnswered?.(requestId ? { requestId } : {});
        return answerOf(response);
      }
      r.onAnswered?.({});
      if (response.status === 404) {
        throw new ChatError('Notes by Kizuna AI are not available yet', { status: 404, code: 'unavailable', retryable: false });
      }
      const refusal = await refusalOf(response);
      if (refusal.code === 'rate_limited' && waited < RATE_LIMIT_WAITS) {
        waited += 1;
        const seconds = Number(response.headers.get('Retry-After'));
        await wait((Number.isFinite(seconds) && seconds > 0 ? seconds : 15) * 1000, r.signal);
        continue;
      }
      const code = refusal.code ? FINAL_CODES[refusal.code] : undefined;
      throw new ChatError(`Kizuna AI refused the notes request (${response.status})`, {
        status: response.status,
        serviceMessage: refusal.message,
        ...(code ? { code, retryable: false } : {}),
        ...(refusal.code && RETRYABLE_CODES.has(refusal.code) ? { retryable: true } : {}),
        ...(!code && !(refusal.code && RETRYABLE_CODES.has(refusal.code)) && response.status < 500 ? { retryable: false } : {}),
      });
    }
  };
}
