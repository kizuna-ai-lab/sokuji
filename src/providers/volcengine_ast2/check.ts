/**
 * Doubao AST 2.0's readiness (spec: "Readiness is one check"; ruling 9):
 * one real handshake — the socket with the credentials in its query, a
 * text-only `StartSession` for the pair, and on `SessionStarted` a
 * `FinishSession` and the close. No audio is sent. Bounded by
 * `CHECK_TIMEOUT_MS` and the caller's signal; the socket is closed on every
 * path. A browser cannot see the upgrade's 401: a socket that fails before
 * it opens is read as refused credentials, unless the device is offline
 * (choice 8). The settings side: not reached by the adapter, so its clock
 * and ids may default to the real ones.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import type { Ast2Credentials, Ast2Settings } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import { ast2Url, decodeResponse, EventType, finishSessionFrame, isOk, OFFLINE, REFUSED_UPGRADE, startSessionFrame, statusFailureCode, statusText } from './wire';

/** As long as Soniox's and Gemini's checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

export interface Ast2CheckDeps {
  openSocket?: OpenSocket;
  clock?: Pick<Clock, 'setTimeout'>;
  newId?: () => string;
  /** False: the device is offline, and a failed socket says nothing about the credentials. */
  online?: () => boolean;
}

export function createAst2Check(deps: Ast2CheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const online = deps.online ?? (() => navigator.onLine !== false);
  return (k: Ast2Credentials, _s: Ast2Settings, ctx: CheckContext): Promise<CheckResult> => {
    if (ctx.signal?.aborted) return Promise.reject(ctx.signal.reason ?? new Error('aborted'));
    // Read at call time, so a test's stubbed global is seen.
    const openSocket = deps.openSocket ?? nativeSocket;
    return new Promise<CheckResult>((resolve, reject) => {
      const ids = { session: newId(), connection: newId() };
      let sequence = 0;
      let opened = false;
      let settled = false;
      const socket = openSocket(ast2Url(k));
      socket.binaryType = 'arraybuffer';
      const finish = (answer: { result: CheckResult } | { error: unknown }) => {
        if (settled) return;
        settled = true;
        cancel();
        ctx.signal?.removeEventListener('abort', onAbort);
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        // CONNECTING or OPEN: close it; CLOSING or CLOSED already is.
        if (socket.readyState <= WS_OPEN) socket.close(1000);
        if ('result' in answer) resolve(answer.result);
        else reject(answer.error);
      };
      const cancel = clock.setTimeout(() => finish({ error: new Error(`Doubao did not answer the check within ${CHECK_TIMEOUT_MS / 1000} s.`) }), CHECK_TIMEOUT_MS);
      const onAbort = () => finish({ error: ctx.signal?.reason ?? new Error('aborted') });
      ctx.signal?.addEventListener('abort', onAbort, { once: true });

      socket.onopen = () => {
        opened = true;
        // Text only: no voice is set up, and every spoken pair also runs as text (ruling 9). The user's pair, so a pair Doubao refuses is refused here.
        socket.send(startSessionFrame({ ids, sequence: sequence++, mode: 's2t', source: ctx.pair.source, target: ctx.pair.target, ...(k.kind === 'app' ? { appKey: k.appKey } : {}) }));
      };
      socket.onmessage = (e: MessageEvent) => {
        let r;
        try {
          r = decodeResponse(e.data);
        } catch {
          return;
        }
        const status = r.responseMeta?.StatusCode ?? 0;
        if (!isOk(status)) {
          finish({ result: { ok: false, code: statusFailureCode(status), reason: statusText(status, r.responseMeta?.Message) } });
        } else if (r.event === EventType.SessionFailed) {
          finish({ result: { ok: false, code: 'server', reason: statusText(status, r.responseMeta?.Message) } });
        } else if (r.event === EventType.SessionStarted) {
          if (socket.readyState === WS_OPEN) socket.send(finishSessionFrame(ids, sequence++));
          finish({ result: { ok: true } });
        }
      };
      socket.onclose = (e: CloseEvent) => {
        if (opened) {
          finish({ error: new Error(`Doubao closed the check's connection before the session started (${e.code}${e.reason ? ` ${e.reason}` : ''}).`) });
        } else if (online()) {
          finish({ result: { ok: false, code: 'auth', reason: REFUSED_UPGRADE } });
        } else {
          finish({ error: new Error(OFFLINE) });
        }
      };
    });
  };
}

export const checkAst2 = createAst2Check();
