import { afterEach, describe, it, expect, vi } from 'vitest';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { flush } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { START_TIMEOUT_MS } from './adapter';
import { CHECK_TIMEOUT_MS, createAst2Check } from './check';
import { AST2_DEFAULTS } from './settings';
import { API_KEY, APP_KEY, counterIds, RefusingWebSocket, SERVER, serverFrame, SESSION_ID, sentRequests, startAst2 } from './testing';
import { AST2_ENDPOINT, ast2Url, EventType, REFUSED_UPGRADE } from './wire';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });

function setup(o: { online?: boolean } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const check = createAst2Check({ openSocket: sockets.create, clock, newId: counterIds(), online: () => o.online ?? true });
  return { sockets, clock, timers, check, socket: () => sockets.last() };
}

describe("Doubao AST 2.0's check (ruling 9)", () => {
  it('opens the socket with the credentials in its query, starts a text-only zh → en session whatever the pair, and on SessionStarted finishes it and closes', async () => {
    const h = setup();
    // The user's pair is ja → en; the check validates the credentials alone, so a pick never needs another one.
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    expect(h.socket().url).toBe(ast2Url(APP_KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open();
    const [start] = sentRequests(h.socket());
    expect(start.event).toBe(EventType.StartSession);
    expect(start.request).toMatchObject({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en' });
    expect(start.targetAudio ?? null).toBeNull();
    expect(start.requestMeta).toMatchObject({ AppKey: '1234567890', SessionID: 'id-1', ConnectionID: 'id-2' });
    h.socket().receive(SERVER.started());
    await expect(answer).resolves.toEqual({ ok: true });
    expect(sentRequests(h.socket()).map((r) => r.event)).toEqual([EventType.StartSession, EventType.FinishSession]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.timers()).toBe(0);
  });

  it('checks an API key the same way, with no App ID in the session', async () => {
    const h = setup();
    const answer = h.check(API_KEY, AST2_DEFAULTS, ctx());
    expect(h.socket().url).toBe(ast2Url(API_KEY));
    h.socket().open();
    expect(sentRequests(h.socket())[0].requestMeta?.AppKey).toBe('');
    h.socket().receive(SERVER.started());
    await expect(answer).resolves.toEqual({ ok: true });
  });

  it('sends no libraries, whatever the settings name (choice 20)', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, { ...AST2_DEFAULTS, hotWordTableId: 'hw', replacementTableId: 'rp', glossaryTableId: 'gl' }, ctx());
    h.socket().open();
    expect(sentRequests(h.socket())[0].request?.corpus ?? null).toBeNull();
    h.socket().receive(SERVER.started());
    await expect(answer).resolves.toEqual({ ok: true });
  });

  it("answers a status refusal not ready, with the server's words and the status's code", async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(SERVER.status(45000001, 'unsupported language pair', EventType.SessionFailed));
    await expect(answer).resolves.toEqual({ ok: false, code: 'client', reason: '[Doubao 45000001] unsupported language pair' });
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it('answers SessionFailed with an OK status not ready, as the service', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(SERVER.failed('quota exhausted'));
    await expect(answer).resolves.toEqual({ ok: false, code: 'server', reason: '[Doubao 20000000] quota exhausted' });
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it("reads a status outside 4xxxxxxx as the service's, through the status rule", async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(SERVER.status(55000001, 'server busy', EventType.SessionStarted));
    await expect(answer).resolves.toEqual({ ok: false, code: 'server', reason: '[Doubao 55000001] server busy' });
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it('reads a socket that fails before it opens as refused credentials — the auth words — while online', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().drop();
    await expect(answer).resolves.toEqual({ ok: false, code: 'auth', reason: REFUSED_UPGRADE });
    expect(h.timers()).toBe(0);
  });

  it('throws when it could not find out: offline, or a close after the socket opened', async () => {
    const offline = setup({ online: false });
    const a = offline.check(APP_KEY, AST2_DEFAULTS, ctx());
    offline.socket().drop();
    await expect(a).rejects.toThrow('The device is offline: Doubao could not be reached.');
    expect(offline.timers()).toBe(0);

    const h = setup();
    const b = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().serverClose(1011, 'busy');
    await expect(b).rejects.toThrow("Doubao closed the check's connection before the session started (1011 busy).");
    expect(h.timers()).toBe(0);
  });

  it('bounds its handshake: no answer within 15 s throws and closes the socket', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);
    h.socket().open();
    h.clock.advance(CHECK_TIMEOUT_MS - 1);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    h.clock.advance(1);
    await expect(answer).rejects.toThrow('Doubao did not answer the check within 15 s.');
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it("the start's signal aborts the handshake, closing the socket and cancelling the timer; an aborted one opens nothing", async () => {
    const h = setup();
    const c = new AbortController();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx(c.signal));
    c.abort(new Error('cancelled'));
    await expect(answer).rejects.toThrow('cancelled');
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);

    const fresh = setup();
    await expect(fresh.check(APP_KEY, AST2_DEFAULTS, ctx(AbortSignal.abort(new Error('gone'))))).rejects.toThrow('gone');
    expect(fresh.sockets.all).toEqual([]);
  });

  it('ignores a frame it cannot read, and still answers', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive('not a frame');
    h.socket().receive(SERVER.started());
    await expect(answer).resolves.toEqual({ ok: true });
  });

  it('words no answer it makes with a credential or the socket URL, in either mode (ruling 2)', async () => {
    // The paths whose words are the check's own: the refused upgrade, the close after open, the timeout and the offline device.
    const words = (p: Promise<CheckResult>) => p.then((r) => JSON.stringify(r), (e: unknown) => String(e));
    for (const k of [APP_KEY, API_KEY]) {
      const answers: string[] = [];
      const refused = setup();
      const a = refused.check(k, AST2_DEFAULTS, ctx());
      refused.socket().drop();
      answers.push(await words(a));
      const closed = setup();
      const b = closed.check(k, AST2_DEFAULTS, ctx());
      closed.socket().open();
      closed.socket().serverClose(1011, 'busy');
      answers.push(await words(b));
      const silent = setup();
      const c = silent.check(k, AST2_DEFAULTS, ctx());
      silent.socket().open();
      silent.clock.advance(CHECK_TIMEOUT_MS);
      answers.push(await words(c));
      const offline = setup({ online: false });
      const d = offline.check(k, AST2_DEFAULTS, ctx());
      offline.socket().drop();
      answers.push(await words(d));
      const secret = k.kind === 'app' ? k.accessKey : k.apiKey;
      // The control: the socket did open with the secret, the legacy mode's App ID, the endpoint and the query's names in its URL.
      const needles = [secret, AST2_ENDPOINT, 'api_', ...(k.kind === 'app' ? [k.appKey] : [])];
      for (const needle of needles) expect(refused.socket().url).toContain(needle);
      for (const answer of answers) for (const needle of needles) expect(answer).not.toContain(needle);
    }
  });

  it.each([
    ['App ID + Access Token', APP_KEY],
    ['API key', API_KEY],
  ] as const)("through the app's own socket, a browser that will not open it rejects the check in fixed words: the reason Settings shows never quotes the URL (%s)", async (_mode, k) => {
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const { clock, timers } = trackedClock();
    // No opener injected: the seam the app uses, reading the stubbed global.
    const check = createAst2Check({ clock, newId: counterIds(), online: () => true });
    const error = await check(k, AST2_DEFAULTS, ctx()).then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ message: 'The browser would not open the socket (SyntaxError).' });
    // A check that throws becomes the readiness reason in these words (`providerStore.ts`' refreshReadiness), which the credential form shows.
    const shown = describeCause(error);
    expect(shown).toBe('The browser would not open the socket (SyntaxError).');
    for (const needle of [ast2Url(k), AST2_ENDPOINT, 'api_', ...(k.kind === 'app' ? [k.appKey, k.accessKey] : [k.apiKey])]) {
      expect(String(error)).not.toContain(needle);
    }
    expect(timers()).toBe(0);
  });

  it('drops a SessionStarted for another session, as the start does: not ready, no FinishSession, and the handshake runs on to its bound', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);
    h.socket().open();
    h.socket().receive(SERVER.started({ session: 'a-session-the-server-named' }));
    await flush();
    expect(settled).not.toHaveBeenCalled();
    expect(sentRequests(h.socket()).map((r) => r.event)).toEqual([EventType.StartSession]);
    h.clock.advance(CHECK_TIMEOUT_MS);
    await expect(answer).rejects.toThrow('Doubao did not answer the check within 15 s.');
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it('hears a refusal whatever session it names, as the start does: its status is read before its session', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(serverFrame({ responseMeta: { SessionID: 'a-session-the-server-named', Sequence: 0, StatusCode: 45000001, Message: 'unsupported language pair' }, event: EventType.SessionFailed }));
    await expect(answer).resolves.toEqual({ ok: false, code: 'client', reason: '[Doubao 45000001] unsupported language pair' });
    expect(h.timers()).toBe(0);
  });

  it('reads a SessionStarted for its own session as ready, and one that names no session too, as the start does', async () => {
    const own = setup();
    const a = own.check(APP_KEY, AST2_DEFAULTS, ctx());
    own.socket().open();
    // The control: the id the answer echoes is the one the check sent.
    expect(sentRequests(own.socket())[0].requestMeta?.SessionID).toBe(SESSION_ID);
    own.socket().receive(SERVER.started({ session: SESSION_ID }));
    await expect(a).resolves.toEqual({ ok: true });

    const unnamed = setup();
    const b = unnamed.check(API_KEY, AST2_DEFAULTS, ctx());
    unnamed.socket().open();
    unnamed.socket().receive(SERVER.started({ session: '' }));
    await expect(b).resolves.toEqual({ ok: true });
  });

  it('agrees with a start on a SessionStarted for another session: neither a ✓ nor a started session, each ending at its own bound', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(SERVER.started({ session: 'a-session-the-server-named' }));

    const start = startAst2();
    const started = vi.fn();
    start.starting.then(started, started);
    start.socket().open();
    start.socket().receive(SERVER.started({ session: 'a-session-the-server-named' }));
    await flush();
    expect(started).not.toHaveBeenCalled();
    expect(start.frames('session.foreign')).toEqual([{ event: 'SessionStarted' }]);

    h.clock.advance(CHECK_TIMEOUT_MS);
    await expect(answer).rejects.toThrow('Doubao did not answer the check within 15 s.');
    start.clock.advance(START_TIMEOUT_MS);
    await expect(start.starting).rejects.toMatchObject({ code: 'server', message: 'Doubao did not start the session within 30 s.' });
  });
});
