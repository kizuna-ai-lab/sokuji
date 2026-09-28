import { describe, it, expect, vi } from 'vitest';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { flush } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { CHECK_TIMEOUT_MS, createAst2Check } from './check';
import { AST2_DEFAULTS } from './settings';
import { API_KEY, APP_KEY, counterIds, SERVER, sentRequests } from './testing';
import { AST2_ENDPOINT, ast2Url, EventType, REFUSED_UPGRADE } from './wire';

const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });

function setup(o: { online?: boolean } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const check = createAst2Check({ openSocket: sockets.create, clock, newId: counterIds(), online: () => o.online ?? true });
  return { sockets, clock, timers, check, socket: () => sockets.last() };
}

describe("Doubao AST 2.0's check (ruling 9)", () => {
  it("opens the socket with the credentials in its query, starts a text-only session for the user's pair, and on SessionStarted finishes it and closes", async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    expect(h.socket().url).toBe(ast2Url(APP_KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open();
    const [start] = sentRequests(h.socket());
    expect(start.event).toBe(EventType.StartSession);
    expect(start.request).toMatchObject({ mode: 's2t', sourceLanguage: 'ja', targetLanguage: 'en' });
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

  it("answers a status refusal not ready, with the server's words and the status's code", async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(SERVER.status(45000001, 'unsupported language pair', EventType.SessionFailed));
    await expect(answer).resolves.toEqual({ ok: false, code: 'client', reason: '[Doubao 45000001] unsupported language pair' });
    expect(h.socket().closedByClient).not.toBeNull();
  });

  it('answers SessionFailed with an OK status not ready, as the service', async () => {
    const h = setup();
    const answer = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().receive(SERVER.failed('quota exhausted'));
    await expect(answer).resolves.toEqual({ ok: false, code: 'server', reason: '[Doubao 20000000] quota exhausted' });
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

    const h = setup();
    const b = h.check(APP_KEY, AST2_DEFAULTS, ctx());
    h.socket().open();
    h.socket().serverClose(1011, 'busy');
    await expect(b).rejects.toThrow("Doubao closed the check's connection before the session started (1011 busy).");
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
      // The control: the socket did open with the secret, the endpoint and the query's names in its URL.
      const needles = [secret, AST2_ENDPOINT, 'api_'];
      for (const needle of needles) expect(refused.socket().url).toContain(needle);
      for (const answer of answers) for (const needle of needles) expect(answer).not.toContain(needle);
    }
  });
});
