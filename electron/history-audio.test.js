// electron/history-audio.test.js
//
// Recordings reach the player through the sokuji-history: scheme, which answers byte ranges.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { openHistory } = nodeRequire('./history-store.js');
const { HISTORY_SCHEME, registerHistoryScheme, trackResponse } = nodeRequire('./history-audio.js');

const ID = 'run-0001-aaaa';
let dir;
let s;
const url = (id = ID, source = 'speaker') => `${HISTORY_SCHEME}://track/${id}/${source}`;
const get = (u, range) => trackResponse(s, new Request(u, range ? { headers: { Range: range } } : {}));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sokuji-history-audio-'));
  s = openHistory({ dir });
  s.openRecord({ id: ID, startedAt: 1_800_000_000_000, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'fake', models: {} }, appVersion: '1' });
  const data = new Uint8Array(10_000);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  s.appendTrack({ recordId: ID, source: 'speaker', offsetMs: 0, durationMs: 1000, data });
});
afterEach(() => {
  s.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the recordings scheme', () => {
  it('is registered as a privileged, streaming scheme', () => {
    const calls = [];
    registerHistoryScheme({ registerSchemesAsPrivileged: (list) => calls.push(list) });
    expect(HISTORY_SCHEME).toBe('sokuji-history');
    expect(calls).toEqual([[{ scheme: 'sokuji-history', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]]);
  });

  it('answers the whole file with its length', async () => {
    const r = await get(url());
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Length')).toBe('10000');
    expect(r.headers.get('Accept-Ranges')).toBe('bytes');
    expect(r.headers.get('Content-Type')).toBe('audio/ogg');
    expect((await r.arrayBuffer()).byteLength).toBe(10_000);
  });

  it("lets the app's own page read a recording (saving it), and no other origin", async () => {
    const from = (origin) => trackResponse(s, new Request(url(), { headers: { Origin: origin } }));
    expect((await from('null')).headers.get('Access-Control-Allow-Origin')).toBe('null');
    expect((await from('file://')).headers.get('Access-Control-Allow-Origin')).toBe('file://');
    expect((await from('http://localhost:5173')).headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect((await from('https://example.com')).headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect((await get(url())).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers a byte range', async () => {
    const r = await get(url(), 'bytes=100-199');
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 100-199/10000');
    const body = new Uint8Array(await r.arrayBuffer());
    expect(body.length).toBe(100);
    expect(body[0]).toBe(100 % 251);
  });

  it('answers an open-ended range to the end of the file', async () => {
    const r = await get(url(), 'bytes=9990-');
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 9990-9999/10000');
    expect((await r.arrayBuffer()).byteLength).toBe(10);
  });

  it('refuses a range past the end', async () => {
    const r = await get(url(), 'bytes=20000-');
    expect(r.status).toBe(416);
    expect(r.headers.get('Content-Range')).toBe('bytes */10000');
  });

  it('finds nothing for a dropped track, an unknown source or record, or a bad address', async () => {
    expect((await get(url(ID, 'participant'))).status).toBe(404);
    expect((await get(url('run-0009-zzzz'))).status).toBe(404);
    expect((await get(`${HISTORY_SCHEME}://track/../../etc/passwd`)).status).toBe(404);
    expect((await get(`${HISTORY_SCHEME}://other/${ID}/speaker`)).status).toBe(404);
    s.dropTrack({ recordId: ID, source: 'speaker' });
    expect((await get(url())).status).toBe(404);
  });
});
