import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { PalabraCredentials } from './settings';
import { PALABRA_API } from './wire';
import { PalabraVoicesClient, PalabraVoicesError } from './voicesClient';

const KEY: PalabraCredentials = { kind: 'apiKey', apiKey: 'plbr_SECRET' };
const APP: PalabraCredentials = { kind: 'app', clientId: 'id', clientSecret: 'sec_VALUE_9f17' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = (fetch: typeof globalThis.fetch, k: PalabraCredentials = KEY) => new PalabraVoicesClient(k, { fetch, clock: createVirtualClock(0) });
type Call = [string, RequestInit];
const calls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls as unknown as Call[];

/** A built-in as `GET /saas/voice/builtin` returns it (measured 2026-11-03), trimmed. */
const builtin = (id: string, over: Record<string, unknown> = {}) => ({
  voice_id: id, voice_type: 'instantly_cloned_builtin', name: 'Hungarian Male ', description: 'General',
  labels: { gender: 'Male', age_group: null, mood: 'Neutral' }, attributes: [], has_external_voice: true, is_favorite: false,
  tts_sample: { url: `https://cdn.palabra.ai/blob/${id}-main.mp3`, text: { content: 'Az emberek…', lang: 'hu' }, provider: 'palabra' },
  tts_samples: [{ url: `https://cdn.palabra.ai/blob/${id}-el.mp3`, text: { content: 'Az emberek…', lang: 'hu' }, provider: 'elevenlabs' }],
  ...over,
});
/** An account voice as `GET /saas/voice` returns it, trimmed. */
const mine = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  voice_id: id, voice_type: 'instantly_cloned', name: 'Sokuji test zh', processing_status: status,
  processing_result: { warnings: [], errors: [] }, labels: null, tts_sample: null, tts_samples: [], ...over,
});
const page = (items: unknown[], next: string | null = null) => json({ ok: true, data: { items, page_size: 100, count: items.length, next } });
const err = (status: number, error_code?: number, detail = 'Palabra says no.') => json({ ok: false, errors: [{ title: 'Error', detail, error_code, status }] }, status);

describe('PalabraVoicesClient', () => {
  it('sends Authorization: Bearer for an API key, and ClientId + ClientSecret for an app pair', async () => {
    const fetch = vi.fn(async () => page([]));
    await client(fetch, KEY).listMine();
    await client(fetch, APP).listMine();
    const [[url, keyInit], [, appInit]] = calls(fetch);
    expect(url).toBe(`${PALABRA_API}/saas/voice?page_size=100`);
    expect(keyInit.headers).toMatchObject({ Accept: 'application/json', Authorization: 'Bearer plbr_SECRET' });
    expect(appInit.headers).toMatchObject({ Accept: 'application/json', ClientId: 'id', ClientSecret: 'sec_VALUE_9f17' });
    expect(appInit.headers).not.toHaveProperty('Authorization');
  });

  it('listBuiltin follows next until it is null', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(page([builtin('a')], 'tok-2'))
      .mockResolvedValueOnce(page([builtin('b')], null));
    const voices = await client(fetch).listBuiltin();
    expect(voices.map((v) => v.id)).toEqual(['a', 'b']);
    const [[first], [second]] = calls(fetch);
    expect(first).toBe(`${PALABRA_API}/saas/voice/builtin?page_size=100`);
    expect(second).toBe(`${PALABRA_API}/saas/voice/builtin?token=tok-2`);
  });

  it('listBuiltin stops after 10 pages', async () => {
    const fetch = vi.fn(async () => page([builtin(`v${Math.random()}`)], 'again'));
    const voices = await client(fetch).listBuiltin();
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(voices).toHaveLength(10);
  });

  it('normalises a built-in', async () => {
    const [v] = await client(vi.fn(async () => page([builtin('94d9')]))).listBuiltin();
    expect(v).toEqual({
      id: '94d9', name: 'Hungarian Male', language: 'hu', facets: { gender: 'male' },
      status: 'ready', sample: 'https://cdn.palabra.ai/blob/94d9-main.mp3',
    });
  });

  it('normalises an account voice: created and pending are processing, failed stays failed', async () => {
    const fetch = vi.fn(async () => page([mine('a', 'created'), mine('b', 'pending'), mine('c', 'failed'), mine('d', 'ready')]));
    const voices = await client(fetch).listMine();
    expect(voices.map((v) => v.status)).toEqual(['processing', 'processing', 'failed', 'ready']);
    expect(voices[0]).toMatchObject({ name: 'Sokuji test zh', facets: {}, sample: null, language: null });
  });

  it('sample falls back to tts_samples[0], else null', async () => {
    const fetch = vi.fn(async () => page([
      builtin('x', { tts_sample: null }),
      builtin('y', { tts_sample: null, tts_samples: [] }),
    ]));
    const [x, y] = await client(fetch).listBuiltin();
    expect(x.sample).toBe('https://cdn.palabra.ai/blob/x-el.mp3');
    expect(x.language).toBe('hu');
    expect(y.sample).toBeNull();
    expect(y.language).toBeNull();
  });

  it('listMine keeps only voice_type instantly_cloned', async () => {
    const fetch = vi.fn(async () => page([mine('own', 'ready'), builtin('shared')]));
    expect((await client(fetch).listMine()).map((v) => v.id)).toEqual(['own']);
  });

  it('create posts metadata, then uploads form_data fields then file last to the pre-signed url', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, data: {
        voice_id: 'new-1', name: 'Teszt hang ő', voice_type: 'instantly_cloned', processing_status: 'created',
        samples: [{ item_id: 'i', blob_id: 'b', url: 'https://palabra-prod-web-cdn.s3.amazonaws.com/', form_data: { key: 'k1', policy: 'p1' } }],
      } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const wav = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    const created = await client(fetch, APP).create({ name: 'Teszt hang ő', wav, langCode: 'hu', denoise: true });
    expect(created).toMatchObject({ id: 'new-1', name: 'Teszt hang ő', status: 'processing' });
    const [[cloneUrl, cloneInit], [uploadUrl, uploadInit]] = calls(fetch);
    expect(cloneUrl).toBe(`${PALABRA_API}/saas/voice/clone`);
    expect(cloneInit.method).toBe('POST');
    expect(JSON.parse(String(cloneInit.body))).toEqual({
      data: { name: 'Teszt hang ő', samples: [{ filename: 'sample.wav', mime_type: 'audio/wav', lang_code: 'hu', denoise: true }] },
    });
    expect(uploadUrl).toBe('https://palabra-prod-web-cdn.s3.amazonaws.com/');
    expect(uploadInit.method).toBe('POST');
    const headers = new Headers(uploadInit.headers);
    expect(headers.has('Authorization') || headers.has('ClientId') || headers.has('ClientSecret')).toBe(false);
    const form = uploadInit.body as FormData;
    expect([...form.keys()]).toEqual(['key', 'policy', 'file']);
    const file = form.get('file') as File;
    expect(file.name).toBe('sample.wav');
    expect(file.type).toBe('audio/wav');
  });

  it('create deletes the voice and throws upload_failed when the upload fails', async () => {
    const cloneAnswer = () => json({ ok: true, data: {
      voice_id: 'half', name: 'x', voice_type: 'instantly_cloned', processing_status: 'created',
      samples: [{ url: 'https://palabra-prod-web-cdn.s3.amazonaws.com/', form_data: {} }],
    } });
    const fetch = vi.fn()
      .mockResolvedValueOnce(cloneAnswer())
      .mockResolvedValueOnce(new Response('<Error/>', { status: 403 }))
      .mockResolvedValueOnce(json({ ok: true, data: { deleted_voice_id: 'half' } }));
    const wav = new Blob([new Uint8Array([1])]);
    await expect(client(fetch).create({ name: 'xyz', wav, langCode: 'en', denoise: false })).rejects.toMatchObject({ errorType: 'upload_failed' });
    const [, , [deleteUrl, deleteInit]] = calls(fetch);
    expect(deleteUrl).toBe(`${PALABRA_API}/saas/voice/m/half`);
    expect(deleteInit.method).toBe('DELETE');

    const failingDelete = vi.fn()
      .mockResolvedValueOnce(cloneAnswer())
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(err(500));
    await expect(client(failingDelete).create({ name: 'xyz', wav, langCode: 'en', denoise: false })).rejects.toMatchObject({ errorType: 'upload_failed' });
  });

  describe('maps errors', () => {
    const wav = new Blob([new Uint8Array([1])]);
    it.each([
      [401, undefined, 'auth'],
      [403, undefined, 'auth'],
      [429, undefined, 'rate_limit'],
      [422, 200200, 'limit_reached'],
      [422, 200046, 'bad_audio'],
      [422, 200041, 'bad_audio'],
      [422, 12345, 'invalid_request'],
    ] as const)('HTTP %s (error_code %s) on create → %s', async (status, code, type) => {
      const fetch = vi.fn(async () => err(status, code, 'Re-encode the audio.'));
      const error = await client(fetch).create({ name: 'xyz', wav, langCode: 'en', denoise: false }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PalabraVoicesError);
      expect(error).toMatchObject({ errorType: type, status });
      if (type === 'bad_audio') expect((error as Error).message).toContain('Re-encode the audio.');
    });

    it('404 on get → not_found', async () => {
      await expect(client(vi.fn(async () => err(404))).get('gone')).rejects.toMatchObject({ errorType: 'not_found', status: 404 });
    });

    it('a rejected fetch → network', async () => {
      await expect(client(vi.fn(async () => { throw new TypeError('Failed to fetch'); })).listMine()).rejects.toMatchObject({ errorType: 'network' });
    });

    it('an aborted signal → aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(client(vi.fn(async () => page([]))).listMine(controller.signal)).rejects.toMatchObject({ errorType: 'aborted' });
    });

    it('get, delete and limits go to their own urls', async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(json({ ok: true, data: mine('a/b', 'ready') }))
        .mockResolvedValueOnce(json({ ok: true, data: { deleted_voice_id: 'a/b' } }))
        .mockResolvedValueOnce(json({ ok: true, data: { created: 0, pending: 0, ready: 1, failed: 0, total: 1, limit: 50, remaining: 49 } }));
      const c = client(fetch);
      await expect(c.get('a/b')).resolves.toMatchObject({ id: 'a/b', status: 'ready' });
      await c.delete('a/b');
      await expect(c.limits()).resolves.toEqual({ used: 1, limit: 50, remaining: 49 });
      expect(calls(fetch).map(([u, i]) => `${i.method} ${u}`)).toEqual([
        `GET ${PALABRA_API}/saas/voice/m/a%2Fb`,
        `DELETE ${PALABRA_API}/saas/voice/m/a%2Fb`,
        `GET ${PALABRA_API}/saas/voice/limits`,
      ]);
    });
  });

  it('a 200 that carries no data is a typed error, not a crash', async () => {
    const c = client(vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(c.get('x')).rejects.toMatchObject({ errorType: 'unknown' });
    await expect(client(vi.fn(async () => new Response('', { status: 200 }))).limits()).rejects.toBeInstanceOf(PalabraVoicesError);
  });

  it('refuses an upload url that is not https, sending the recording nowhere and deleting the half-made voice', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, data: { voice_id: 'h', name: 'x', voice_type: 'instantly_cloned', processing_status: 'created', samples: [{ url: 'http://evil.example/', form_data: {} }] } }))
      .mockResolvedValueOnce(json({ ok: true, data: { deleted_voice_id: 'h' } }));
    const wav = new Blob([new Uint8Array([1])]);
    await expect(client(fetch).create({ name: 'xyz', wav, langCode: 'en', denoise: false })).rejects.toMatchObject({ errorType: 'upload_failed' });
    const urls = calls(fetch).map(([u]) => u);
    expect(urls).not.toContain('http://evil.example/');
    expect(urls).toContain(`${PALABRA_API}/saas/voice/m/h`);
  });

  it('a response whose body never arrives still times out (the bound covers the body)', async () => {
    const clock = createVirtualClock(0);
    const stalled = { ok: true, status: 200, json: () => new Promise(() => {}) } as unknown as Response;
    const c = new PalabraVoicesClient(KEY, { fetch: vi.fn(async () => stalled), clock });
    const pending = c.limits();
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(15_000);
    await expect(pending).rejects.toMatchObject({ errorType: 'timeout' });
  });

  it('a list page without items is a typed error, not an empty roster', async () => {
    const c = client(vi.fn(async () => json({ ok: true, data: { page_size: 100, count: 0, next: null } })));
    await expect(c.listMine()).rejects.toMatchObject({ errorType: 'unknown' });
  });

  it('a list page holding a null item is a typed error, not a crash', async () => {
    const c = client(vi.fn(async () => page([mine('a', 'ready'), null])));
    await expect(c.listMine()).rejects.toMatchObject({ errorType: 'unknown' });
    await expect(client(vi.fn(async () => page([null]))).listBuiltin()).rejects.toBeInstanceOf(PalabraVoicesError);
    // An array, or an object without a voice id, is no voice either.
    await expect(client(vi.fn(async () => page([[]]))).listBuiltin()).rejects.toBeInstanceOf(PalabraVoicesError);
    await expect(client(vi.fn(async () => page([{ name: 'no id' }]))).listBuiltin()).rejects.toBeInstanceOf(PalabraVoicesError);
  });

  it('odd sample or label shapes on a voice with an id never crash: they read as no sample, no labels', async () => {
    const odd = [
      { voice_id: 'a', tts_samples: {} },
      { voice_id: 'b', tts_samples: 'x', tts_sample: 'x' },
      { voice_id: 'c', tts_samples: [null, 5, { url: 7 }], labels: 'x', name: 5 },
      { voice_id: 'd', tts_sample: { url: 'https://cdn.palabra.ai/d.mp3', text: 'hu' }, labels: { gender: 3 } },
    ];
    const voices = await client(vi.fn(async () => page(odd))).listBuiltin();
    expect(voices.map((v) => [v.id, v.sample, v.language, v.facets])).toEqual([
      ['a', null, null, {}], ['b', null, null, {}], ['c', null, null, {}], ['d', 'https://cdn.palabra.ai/d.mp3', null, {}],
    ]);
    expect(voices[2].name).toBe('');
    // The single-voice read goes through the same reading.
    await expect(client(vi.fn(async () => json({ ok: true, data: { voice_id: 'e', tts_samples: {}, processing_status: 'ready' } }))).get('e'))
      .resolves.toMatchObject({ id: 'e', sample: null });
  });

  it('the preview sample is the first one at a usable https address: a blank or http one is passed over', async () => {
    const ok = 'https://cdn.palabra.ai/blob/ok.mp3';
    const voices = await client(vi.fn(async () => page([
      { voice_id: 'blank', tts_sample: { url: '   ', text: { lang: 'en' } }, tts_samples: [{ url: ok, text: { lang: 'hu' } }] },
      { voice_id: 'http', tts_sample: { url: 'http://cdn.palabra.ai/blob/x.mp3' }, tts_samples: [{ url: ok, text: { lang: 'ja' } }] },
      { voice_id: 'none', tts_sample: { url: ' ' } },
      { voice_id: 'padded', tts_sample: { url: `  ${ok}  `, text: { lang: 'fr' } } },
    ]))).listBuiltin();
    expect(voices.map((v) => [v.id, v.sample, v.language])).toEqual([['blank', ok, 'hu'], ['http', ok, 'ja'], ['none', null, null], ['padded', ok, 'fr']]);
  });

  it('a refusal whose body never arrives still times out', async () => {
    const clock = createVirtualClock(0);
    const stalled = { ok: false, status: 500, json: () => new Promise(() => {}) } as unknown as Response;
    const c = new PalabraVoicesClient(KEY, { fetch: vi.fn(async () => stalled), clock });
    const pending = c.limits();
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(15_000);
    await expect(pending).rejects.toMatchObject({ errorType: 'timeout' });
  });

  it('a credential reflected in Palabra\'s own words is masked', async () => {
    // A client knows only its own credentials: each echoes back the one it sent, whatever its length.
    const SHORT: PalabraCredentials = { kind: 'app', clientId: 'c7x', clientSecret: 's9q2' };
    for (const [k, secrets] of [[KEY, ['plbr_SECRET']], [APP, ['sec_VALUE_9f17']], [SHORT, ['c7x', 's9q2']]] as const) {
      const fetch = vi.fn(async () => err(401, undefined, `Bad credentials: ${secrets.join(' / ')}`));
      const error = (await client(fetch, k).listMine().catch((e: unknown) => e)) as Error;
      for (const secret of secrets) expect(error.message).not.toContain(secret);
    }
  });

  it('thrown messages never contain the credential', async () => {
    const wav = new Blob([new Uint8Array([1])]);
    const failures: Array<() => Promise<unknown>> = [];
    for (const k of [KEY, APP]) {
      for (const response of [() => err(401), () => err(429), () => err(422, 200200), () => err(422, 200046), () => err(500), () => new Response('nope', { status: 502 })]) {
        const c = client(vi.fn(async () => response()), k);
        failures.push(() => c.listMine(), () => c.get('x'), () => c.create({ name: 'xyz', wav, langCode: 'en', denoise: false }), () => c.delete('x'), () => c.limits());
      }
      const down = client(vi.fn(async () => { throw new TypeError('Failed to fetch'); }), k);
      failures.push(() => down.listBuiltin());
    }
    for (const run of failures) {
      const error = await run().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PalabraVoicesError);
      for (const secret of ['plbr_SECRET', 'sec_VALUE_9f17']) expect((error as Error).message).not.toContain(secret);
    }
  });
});
