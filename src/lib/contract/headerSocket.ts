/**
 * F14, the header seam (spec: "Sockets that need upgrade headers"): a socket
 * opened with upgrade headers set and others removed, which a browser cannot
 * do itself. Its first user is OpenAI Live, whose upgrade needs a real
 * `Authorization: Bearer` and no `Origin` (the owner's probe, U9: `Origin`
 * 403, subprotocol alone 401). Each platform installs a rule where the
 * upgrade is made — Electron's main process, the extension's background —
 * behind one interface (Stage 2 OpenAI Live, ruling 7; choice 1):
 *
 * - **The rule's key** is the URL's host and path: Electron's rule applies
 *   to an upgrade whose path starts with it, so a Live rule never reaches
 *   OpenAI Realtime's or Translate's upgrade on the same host (the spec's
 *   amendment 10), and the extension's rule is path-scoped the same way.
 * - **One upgrade at a time per key**, process-wide: Electron's rule is
 *   one-shot and the extension's is cleared as soon as the upgrade is made,
 *   so two legs — at the start, or reconnecting after the same drop —
 *   register and upgrade one after the other. Keys that differ do not wait —
 *   though an extension rule for a path also reaches the paths under it, and
 *   two windows share one rule: only OpenAI Live uses the seam today.
 * - **The bound**: registration and upgrade within `HEADER_SOCKET_CAP_MS` of
 *   the gate, on the caller's clock. The holder lets the gate go when its
 *   bound fires, even with its registration unanswered, so the wait at the
 *   gate is bounded by the holder's own.
 * - **The ending**: the rule is cleared at the socket's first `open`,
 *   `error` or `close` — a no-op on Electron, whose upgrade consumed it —
 *   and after an abort or the bound, and only then is the gate let go, so a
 *   clear never lands on the next leg's rule. An abort rejects at once and
 *   opens nothing. A registration still in flight when the attempt ends is
 *   cleared at once: each platform's channel is ordered — Electron's IPC,
 *   the extension's runtime messages — so the clear lands after it.
 * - **The words**: fixed. No header value leaves the seam — the key rides
 *   in the registration alone — and a browser that refuses the socket is
 *   rethrown by `nativeSocket` without its message.
 *
 * It resolves with the socket once it is open, its own listeners gone: the
 * caller attaches its handlers in the microtask after, before any message
 * task. The web build has no platform to install a rule: it refuses.
 */
import type { Clock } from './clock';
import { nativeSocket } from './socket';
import { getEnvironment } from '../../utils/environment';

/** The headers an upgrade needs: set, by name; removed, by name, case-insensitively. */
export interface UpgradeHeaders {
  set: Readonly<Record<string, string>>;
  remove?: readonly string[];
}

export type OpenHeaderSocket = (url: string, headers: UpgradeHeaders, o: { signal: AbortSignal; clock: Pick<Clock, 'setTimeout'> }) => Promise<WebSocket>;

/** One rule as a platform installs it: the upgrade's host, the path it applies under, the headers set and the names removed. */
export interface HeaderRule {
  host: string;
  path: string;
  set: Readonly<Record<string, string>>;
  remove: readonly string[];
}

/** A platform's way to install a rule and take it away. */
export interface HeaderRegistrar {
  /** Resolves once the rule is installed; rejects when the platform would not. */
  set(rule: HeaderRule): Promise<void>;
  /** Removes the rule if it is still installed; answers nothing. */
  clear(rule: Pick<HeaderRule, 'host' | 'path'>): void;
}

/** How long registration and upgrade may take once the gate is held: the old client's cap, now counting the registration too. */
export const HEADER_SOCKET_CAP_MS = 15_000;

export type HeaderSocketFailure = 'unsupported' | 'register' | 'never_opened' | 'timeout';

/** Why the seam gave no socket, in fixed words; `cause` is the platform's own failure, for the console. Set here, not passed to `super`: this project's lib (ES2020) has no `Error` options. */
export class HeaderSocketError extends Error {
  readonly cause?: unknown;

  constructor(readonly reason: HeaderSocketFailure, message: string, cause?: unknown) {
    super(message);
    this.name = 'HeaderSocketError';
    this.cause = cause;
  }
}

/** The rule a URL's upgrade takes: its host, and its path up to the last `/`, which the endpoint's own paths share (`/v1/live/sessions` → `/v1/live/`). */
export function ruleFor(url: string, headers: UpgradeHeaders): HeaderRule {
  const u = new URL(url);
  return { host: u.host, path: u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1), set: { ...headers.set }, remove: [...(headers.remove ?? [])] };
}

export function createHeaderSocket(registrar: () => HeaderRegistrar | null, openSocket: (url: string) => WebSocket = nativeSocket): OpenHeaderSocket {
  /** Per rule key, the tail of the queue: a leg waits for every leg before it. */
  const gates = new Map<string, Promise<void>>();
  const acquire = (key: string): Promise<() => void> => {
    const before = gates.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const tail = before.then(() => mine);
    gates.set(key, tail);
    return before.then(() => () => {
      release();
      if (gates.get(key) === tail) gates.delete(key);
    });
  };

  return (url, headers, o) => new Promise<WebSocket>((resolve, reject) => {
    if (o.signal.aborted) {
      reject(o.signal.reason ?? new Error('aborted'));
      return;
    }
    const platform = registrar();
    if (!platform) {
      reject(new HeaderSocketError('unsupported', 'This build cannot set a socket\'s upgrade headers: the desktop app or the browser extension can.'));
      return;
    }
    const rule = ruleFor(url, headers);
    let settled = false;
    /** Wakes the attempt from its wait — on the registration, then on the socket: it opened or failed, an abort, the bound. */
    let wake: () => void = () => {};
    let socket: WebSocket | null = null;
    const listeners = {
      open: () => {
        if (settled) return;
        settled = true;
        detach();
        wake();
        resolve(socket as WebSocket);
      },
      failed: () => fail(new HeaderSocketError('never_opened', 'The socket closed before it opened.')),
    };
    const detach = () => {
      socket?.removeEventListener('open', listeners.open);
      socket?.removeEventListener('error', listeners.failed);
      socket?.removeEventListener('close', listeners.failed);
    };
    const onAbort = () => fail(o.signal.reason ?? new Error('aborted'));
    o.signal.addEventListener('abort', onAbort, { once: true });
    let cancelCap: () => void = () => {};
    function fail(error: unknown): void {
      if (settled) return;
      settled = true;
      detach();
      if (socket && socket.readyState <= 1) socket.close();
      wake();
      reject(error);
    }

    void (async () => {
      const letGo = await acquire(`${rule.host}${rule.path}`);
      /** The rule went to the platform and was not refused: however the attempt ends, it is cleared. */
      let sent = false;
      try {
        if (settled) return;
        /** The attempt's end: the socket's first open, error or close, an abort, or the bound. */
        const ended = new Promise<void>((resolve) => { wake = resolve; });
        cancelCap = o.clock.setTimeout(() => fail(new HeaderSocketError('timeout', `The socket did not open within ${HEADER_SOCKET_CAP_MS / 1000} s.`)), HEADER_SOCKET_CAP_MS);
        sent = true;
        // The registration's answer or the attempt's end, whichever comes first: a registration that never answers holds the gate no longer than the bound.
        const refused = await Promise.race([
          platform.set(rule).then(() => null, (error: unknown) => ({ error })),
          ended.then(() => null),
        ]);
        if (refused) {
          // A refusal is ambiguous on the extension (the worker can die after installing the rule, before answering): the clear
          // below runs all the same, idempotent on both platforms (Stage 2 OpenAI Live, ruling 7).
          fail(new HeaderSocketError('register', 'The app could not set the socket\'s upgrade headers.', refused.error));
          return;
        }
        if (settled) return;
        try {
          socket = openSocket(url);
        } catch (error) {
          fail(error);
          return;
        }
        socket.addEventListener('open', listeners.open);
        socket.addEventListener('error', listeners.failed);
        socket.addEventListener('close', listeners.failed);
        await ended;
      } finally {
        cancelCap();
        o.signal.removeEventListener('abort', onAbort);
        // Electron's rule went with the upgrade; the extension's goes now. A registration still in flight, or one the platform
        // refused, is cleared too — a refusal may follow the platform installing the rule (the page closing mid-upgrade, or,
        // on the extension, its worker dying between install and answer): each platform's channel is ordered, so the clear
        // lands after it, and the next leg's registration after the clear.
        if (sent) platform.clear(rule);
        letGo();
      }
    })();
  });
}

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<unknown> }
interface ChromeRuntime { sendMessage(message: unknown, callback?: (response: unknown) => void): void; lastError?: { message?: string } }

/** Electron's main process (`electron/ws-header-rules.js`): its rule applies to the next upgrade under the path, once. */
export function electronRegistrar(electron: ElectronInvoke): HeaderRegistrar {
  return {
    async set(rule) {
      const answer = (await electron.invoke('ws-headers-set', { host: rule.host, path: rule.path, headers: rule.set, removeHeaders: rule.remove })) as { success?: boolean; error?: unknown } | undefined;
      if (!answer?.success) throw new Error(`ws-headers-set: ${typeof answer?.error === 'string' ? answer.error : 'no answer'}`);
    },
    clear(rule) {
      void electron.invoke('ws-headers-clear', { host: rule.host, path: rule.path }).catch(() => {});
    },
  };
}

/** The extension's background (`WS_HEADERS_SET` / `WS_HEADERS_CLEAR`): a rule scoped to the path and to the extension's own pages. */
export function extensionRegistrar(runtime: ChromeRuntime): HeaderRegistrar {
  return {
    set: (rule) => new Promise<void>((resolve, reject) => {
      runtime.sendMessage({ type: 'WS_HEADERS_SET', host: rule.host, path: rule.path, set: rule.set, remove: rule.remove }, (response) => {
        const answer = response as { success?: boolean; error?: unknown } | undefined;
        if (runtime.lastError) reject(new Error(`WS_HEADERS_SET: ${runtime.lastError.message ?? 'no answer'}`));
        else if (!answer?.success) reject(new Error(`WS_HEADERS_SET: ${typeof answer?.error === 'string' ? answer.error : 'no answer'}`));
        else resolve();
      });
    }),
    clear(rule) {
      try {
        runtime.sendMessage({ type: 'WS_HEADERS_CLEAR', host: rule.host, path: rule.path }, () => {
          // Read, so Chrome does not warn of an unchecked error when nothing answers.
          void runtime.lastError;
        });
      } catch {
        // The background is gone: its rules are swept at its next start.
      }
    },
  };
}

/** The registrar this platform has, read at each open: none on the web. */
export function platformRegistrar(): HeaderRegistrar | null {
  const env = getEnvironment();
  if (env === 'electron' && typeof window.electron?.invoke === 'function') return electronRegistrar(window.electron);
  const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  if (env === 'extension' && runtime && typeof runtime.sendMessage === 'function') return extensionRegistrar(runtime);
  return null;
}

/** The app's seam: one queue per rule key for the whole renderer. */
export const platformHeaderSocket: OpenHeaderSocket = createHeaderSocket(platformRegistrar);
