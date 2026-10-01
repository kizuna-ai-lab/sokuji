/**
 * `fakeRest`'s own browser behaviour (fix round 1, M2): the plan's adapter
 * cases rest on it to catch an adapter that leaks a session by ignoring an
 * abort — a guard proves nothing unless its own tests can fail. Killed
 * mutants (the review's scratch): the body rule removed (`fake-body-ignores-abort`)
 * and the pre-call abort check removed (`fake-no-prefetch-abort`).
 */
import { describe, it, expect } from 'vitest';
import { CREATED_BODY, fakeRest } from './testing';

const abortName = (e: unknown): string | undefined => (e as { name?: string } | undefined)?.name;

describe("Palabra AI's fixtures: fakeRest as a browser fetch (fix round 1)", () => {
  it('rejects a request whose signal is already aborted, and still records the call', async () => {
    const rest = fakeRest();
    const controller = new AbortController();
    controller.abort();
    const err = await rest.fetch('https://x', { method: 'POST', signal: controller.signal }).catch((e) => e);
    expect(abortName(err)).toBe('AbortError');
    expect(rest.calls).toHaveLength(1);
  });

  it("rejects a 'hang' or 'later' answer whose signal was aborted before fetch() was even called — the pre-call check (kills fake-no-prefetch-abort)", async () => {
    const hang = fakeRest({ create: 'hang' });
    const hangController = new AbortController();
    hangController.abort();
    const hangErr = await hang.fetch('https://x', { method: 'POST', signal: hangController.signal }).catch((e) => e);
    expect(abortName(hangErr)).toBe('AbortError');

    const later = fakeRest({ create: 'later' });
    const laterController = new AbortController();
    laterController.abort();
    const laterErr = await later.fetch('https://x', { method: 'POST', signal: laterController.signal }).catch((e) => e);
    expect(abortName(laterErr)).toBe('AbortError');
  });

  it("rejects a 'hang' answer when its signal aborts after the call, and a 'later' one aborted before answer()", async () => {
    const hang = fakeRest({ create: 'hang' });
    const hangController = new AbortController();
    const hanging = hang.fetch('https://x', { method: 'POST', signal: hangController.signal });
    hangController.abort();
    expect(abortName(await hanging.catch((e) => e))).toBe('AbortError');

    const later = fakeRest({ create: 'later' });
    const laterController = new AbortController();
    const held = later.fetch('https://x', { method: 'POST', signal: laterController.signal });
    laterController.abort();
    later.answer();
    expect(abortName(await held.catch((e) => e))).toBe('AbortError');
  });

  it("rejects reading an answer's body, both json() and text(), once its request has aborted — choice 9 (kills fake-body-ignores-abort)", async () => {
    const rest = fakeRest({ create: 'later' });
    const controller = new AbortController();
    const pending = rest.fetch('https://x', { method: 'POST', signal: controller.signal });
    rest.answer();
    const res = await pending;
    expect(res.status).toBe(201);
    controller.abort();
    expect(abortName(await res.json().catch((e) => e))).toBe('AbortError');
    expect(abortName(await res.text().catch((e) => e))).toBe('AbortError');
  });

  it('rejects even an "ok" answer aborted in the same tick as fetch() (fix round 1, M3a)', async () => {
    const rest = fakeRest();
    const controller = new AbortController();
    const pending = rest.fetch('https://x', { method: 'DELETE', signal: controller.signal });
    controller.abort();
    expect(abortName(await pending.catch((e) => e))).toBe('AbortError');
  });

  it('rejects a body read already under way when the abort lands before it settles (fix round 1, M3b)', async () => {
    const rest = fakeRest();
    const controller = new AbortController();
    const res = await rest.fetch('https://x', { method: 'POST', signal: controller.signal });
    const reading = res.json();
    controller.abort();
    expect(abortName(await reading.catch((e) => e))).toBe('AbortError');
  });

  it('reads the body normally when the request is never aborted', async () => {
    const rest = fakeRest();
    const res = await rest.fetch('https://x', { method: 'POST', signal: new AbortController().signal });
    expect(await res.json()).toEqual(CREATED_BODY);
  });

  it('records keepalive and every header, normalised to lowercase names as a browser does (fix round 1, M3c)', async () => {
    const rest = fakeRest();
    await rest.fetch('https://x/del', { method: 'DELETE', headers: { Authorization: 'Bearer x' }, keepalive: true });
    expect(rest.of('DELETE')[0]).toMatchObject({ keepalive: true, headers: { authorization: 'Bearer x' } });
  });

  it('normalises a Headers instance and an array of pairs to the same lowercase record (fix round 1, M3c)', async () => {
    const rest = fakeRest();
    await rest.fetch('https://x', { method: 'GET', headers: new Headers({ Authorization: 'Bearer x' }) });
    await rest.fetch('https://x', { method: 'GET', headers: [['Authorization', 'Bearer y']] });
    expect(rest.calls[0].headers).toEqual({ authorization: 'Bearer x' });
    expect(rest.calls[1].headers).toEqual({ authorization: 'Bearer y' });
  });

  it("words a status answer's envelope by the status, not always 'Unauthorized' (fix round 1, M3d)", async () => {
    const notFound = fakeRest({ create: 404 });
    const res404 = await notFound.fetch('https://x', { method: 'POST' });
    const body404 = (await res404.json()) as { errors: Array<{ title: string }> };
    expect(body404.errors[0].title).toBe('Not Found');

    const serverError = fakeRest({ create: 500 });
    const res500 = await serverError.fetch('https://x', { method: 'POST' });
    const body500 = (await res500.json()) as { errors: Array<{ title: string }> };
    expect(res500.status).toBe(500);
    expect(body500.errors[0].title).not.toBe('Unauthorized');
  });
});
