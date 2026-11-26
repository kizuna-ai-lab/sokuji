// @vitest-environment node
/**
 * Downloads into the hub cache against a local fake hub: resume, sha256 verification, the huggingface_hub layout,
 * cancellation, HF_ENDPOINT; then the model-level download (ported from sidecar/tests/test_native_models.py): specs,
 * byte and unit progress, the chosen variant, an unlistable repo.
 */
import '../test/env';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeHub } from '../test/fakeHub';
import { freshHfHome } from '../test/hfFixture';
import { cachedFilePath, repoDir } from './hfCache';
import { downloadFile, downloadModel, downloadSeams, restoreDownloadSeams } from './download';
import { modelSize, resetSizeCacheForTests } from './specs';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const REPO = 'acme/big-gguf';
const FILE = 'model-Q8_0.gguf';

let hub: FakeHub;
let cleanup: () => void;
let content: Buffer;
beforeEach(async () => {
  cleanup = freshHfHome();
  hub = await FakeHub.start();
  content = randomBytes(3_000_000);
  hub.addFile(REPO, FILE, content);
});
afterEach(async () => {
  restoreDownloadSeams();
  resetSizeCacheForTests();
  await hub.close();
  cleanup();
});

describe('downloadFile', () => {
  it('resumes an interrupted download with a Range request', async () => {
    hub.dropAfter(1_000_000);                       // the first attempt dies at 1 MB
    await expect(downloadFile(REPO, FILE, { endpoint: hub.url })).rejects.toThrow();
    hub.dropAfter(null);
    const p = await downloadFile(REPO, FILE, { endpoint: hub.url });
    expect(hub.lastRange).toBe('bytes=1000000-');
    expect(sha256(fs.readFileSync(p))).toBe(hub.sha256(FILE));
  });

  it('rejects a blob whose sha256 does not match and keeps no finished blob', async () => {
    hub.corrupt(FILE);
    await expect(downloadFile(REPO, FILE, { endpoint: hub.url })).rejects.toThrow(/sha256/);
    const blobs = path.join(repoDir(REPO), 'blobs');
    expect(fs.readdirSync(blobs)).toEqual([]);      // neither the blob nor a resumable .incomplete
    expect(cachedFilePath(REPO, FILE)).toBeNull();
  });

  it('writes the huggingface_hub layout', async () => {
    hub.addFile(REPO, 'dir/nested.gguf', 'nested');
    const p = await downloadFile(REPO, FILE, { endpoint: hub.url });
    const n = await downloadFile(REPO, 'dir/nested.gguf', { endpoint: hub.url });
    const dir = repoDir(REPO);
    expect(fs.readFileSync(path.join(dir, 'refs', 'main'), 'utf8')).toBe(hub.commit);
    expect(p).toBe(path.join(dir, 'snapshots', hub.commit, FILE));
    expect(fs.readlinkSync(p)).toBe(`../../blobs/${hub.etag(FILE)}`);
    expect(fs.readlinkSync(n)).toBe(`../../../blobs/${hub.etag('dir/nested.gguf')}`);
    expect(hub.etag(FILE)).toBe(sha256(content));
    expect(cachedFilePath(REPO, FILE)).toBe(p);
  });

  it('cancels between chunks, and the next call resumes', async () => {
    const controller = new AbortController();
    let seen = 0;
    await expect(downloadFile(REPO, FILE, { endpoint: hub.url, signal: controller.signal, onBytes: (n) => { seen += n; controller.abort(); } })).rejects.toThrow();
    const incomplete = path.join(repoDir(REPO), 'blobs', `${hub.etag(FILE)}.incomplete`);
    expect(fs.statSync(incomplete).size).toBe(seen);
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(content.length);
    const p = await downloadFile(REPO, FILE, { endpoint: hub.url });
    expect(hub.lastRange).toBe(`bytes=${seen}-`);
    expect(sha256(fs.readFileSync(p))).toBe(sha256(content));
  });

  it('honours HF_ENDPOINT', async () => {
    process.env.HF_ENDPOINT = hub.url;
    try {
      const p = await downloadFile(REPO, FILE);
      expect(sha256(fs.readFileSync(p))).toBe(sha256(content));
    } finally {
      process.env.HF_ENDPOINT = 'http://127.0.0.1:9';
    }
  });

  it('a plain (non-LFS) file is named by its git blob id and needs no sha256', async () => {
    hub.addFile(REPO, 'config.json', '{"a":1}', { lfs: false });
    const p = await downloadFile(REPO, 'config.json', { endpoint: hub.url });
    expect(fs.readFileSync(p, 'utf8')).toBe('{"a":1}');
    expect(path.basename(fs.realpathSync(p))).toBe(hub.etag('config.json'));
  });

  it('a cached file costs one HEAD; an unreachable hub falls back to the cache', async () => {
    const p = await downloadFile(REPO, FILE, { endpoint: hub.url });
    const before = hub.requests.length;
    expect(await downloadFile(REPO, FILE, { endpoint: hub.url })).toBe(p);
    expect(hub.requests.slice(before).map((r) => r.method)).toEqual(['HEAD']);
    expect(await downloadFile(REPO, FILE, { endpoint: 'http://127.0.0.1:9' })).toBe(p);
  });

  it('a missing file is an error, never a cached fallback', async () => {
    await expect(downloadFile(REPO, 'nope.gguf', { endpoint: hub.url })).rejects.toThrow(/404/);
  });

  it('offline, the cache or an error', async () => {
    const p = await downloadFile(REPO, FILE, { endpoint: hub.url });
    process.env.HF_HUB_OFFLINE = '1';
    try {
      const before = hub.requests.length;
      expect(await downloadFile(REPO, FILE, { endpoint: hub.url })).toBe(p);
      await expect(downloadFile(REPO, 'other.gguf', { endpoint: hub.url })).rejects.toThrow(/HF_HUB_OFFLINE/);
      expect(hub.requests.length).toBe(before);
    } finally {
      delete process.env.HF_HUB_OFFLINE;
    }
  });

  it('refuses a path that would leave the cache', async () => {
    await expect(downloadFile(REPO, '../../escape', { endpoint: hub.url })).rejects.toThrow(/unsafe/);
  });
});

const collect = () => {
  const sent: Array<Record<string, any>> = [];
  return { sent, send: async (m: Record<string, unknown>) => { sent.push(m); } };
};
const progressOf = (sent: Array<Record<string, any>>) => sent.filter((m) => m.type === 'model_progress').map((m) => [m.downloaded, m.total]);

describe('downloadModel', () => {
  it('a repo whose files cannot be listed is an error, not ready', async () => {
    downloadSeams.downloadSpecs = () => ({ repos: ['bogus/repo'], urls: [] });
    await expect(downloadModel('bogus-model', collect().send, { endpoint: hub.url })).rejects.toThrow(/no downloadable files for bogus-model/);
  });

  it('a whole repo leaves out the ignored files', async () => {
    for (const f of ['model.safetensors', 'consolidated.safetensors', 'config.json', 'tekken.json']) hub.addFile('acme/r', f, f);
    downloadSeams.downloadSpecs = () => ({ repos: ['acme/r'], urls: [], ignore: ['consolidated.safetensors'] });
    expect(await downloadModel('voxtral-mini-4b-realtime', collect().send, { endpoint: hub.url })).toBe('ready');
    expect(cachedFilePath('acme/r', 'consolidated.safetensors')).toBeNull();
    expect(['model.safetensors', 'tekken.json', 'config.json'].every((f) => cachedFilePath('acme/r', f) !== null)).toBe(true);
  });

  it('a directory glob keeps nested files out', async () => {
    for (const f of ['model.safetensors', 'config.json', 'train/train.py', 'train/deepspeed/ds.json', 'imgs/overview.png']) hub.addFile('acme/g', f, f);
    downloadSeams.downloadSpecs = () => ({ repos: ['acme/g'], urls: [], ignore: ['train/*', 'imgs/*'] });
    const fetched: string[] = [];
    const real = downloadSeams.downloadFile;
    downloadSeams.downloadFile = (r, f, o) => { fetched.push(f); return real(r, f, o); };
    expect(await downloadModel('hy-mt2-1.8b', collect().send, { endpoint: hub.url })).toBe('ready');
    expect(fetched).toEqual(['config.json', 'model.safetensors']);
  });

  it('fetches the chosen variant repo, not the default', async () => {
    hub.addFile('tencent/Hy-MT2-7B-FP8', 'model.safetensors', 'fp8');
    hub.addFile('tencent/Hy-MT2-7B-FP8', 'config.json', '{}', { lfs: false });
    const repos: string[] = [];
    const real = downloadSeams.downloadFile;
    downloadSeams.downloadFile = (r, f, o) => { repos.push(r); return real(r, f, o); };
    expect(await downloadModel('hy-mt2-7b', collect().send, { endpoint: hub.url, repo: 'tencent/Hy-MT2-7B-FP8' })).toBe('ready');
    expect(repos.length).toBeGreaterThan(0);
    expect(repos.every((r) => r === 'tencent/Hy-MT2-7B-FP8')).toBe(true);
  });

  it('reports bytes when the size is known, the last message exactly the total', async () => {
    hub.addFile('org/r', 'a.gguf', Buffer.alloc(600, 1));
    hub.addFile('org/r', 'b.bin', Buffer.alloc(400, 2));
    downloadSeams.downloadSpecs = () => ({ repos: [], urls: [], files: [['org/r', 'a.gguf'], ['org/r', 'b.bin']] });
    downloadSeams.modelSize = async () => 1000;
    downloadSeams.progressIntervalMs = 60_000;
    const { sent, send } = collect();
    expect(await downloadModel('whisper-base', send, { endpoint: hub.url })).toBe('ready');
    const prog = progressOf(sent);
    expect(prog[0]).toEqual([600, 1000]);           // the first file's real bytes, not "1 of 2"
    expect(prog.at(-1)).toEqual([1000, 1000]);
  });

  it('streams in-flight progress during one big file, capped below the total', async () => {
    downloadSeams.downloadSpecs = () => ({ repos: [], urls: [], files: [[REPO, FILE]] });
    downloadSeams.modelSize = async () => content.length;
    downloadSeams.progressIntervalMs = 0;
    const { sent, send } = collect();
    expect(await downloadModel('whisper-base', send, { endpoint: hub.url })).toBe('ready');
    const mids = progressOf(sent).map(([d]) => d);
    expect(mids.slice(0, -1).some((v) => v > 0 && v < content.length)).toBe(true);
    expect(mids.slice(0, -1).every((v) => v <= content.length - 1)).toBe(true);
    expect(mids.at(-1)).toBe(content.length);
  });

  it('counts files when the size is unknown', async () => {
    hub.addFile('org/r', 'a', 'x');
    downloadSeams.downloadSpecs = () => ({ repos: [], urls: [], files: [['org/r', 'a'], ['org/r', 'a']] });
    downloadSeams.modelSize = async () => 0;
    const { sent, send } = collect();
    expect(await downloadModel('mystery-model', send, { endpoint: hub.url })).toBe('ready');
    expect(progressOf(sent)).toEqual([[1, 2], [2, 2]]);
  });

  it('an aborted signal is cancelled, before a file or during one', async () => {
    downloadSeams.downloadSpecs = () => ({ repos: [], urls: [], files: [[REPO, FILE]] });
    const before = new AbortController();
    before.abort();
    expect(await downloadModel('m', collect().send, { endpoint: hub.url, signal: before.signal })).toBe('cancelled');
    const during = new AbortController();
    const real = downloadSeams.downloadFile;
    downloadSeams.downloadFile = (r, f, o) => real(r, f, { ...o, onBytes: (n) => { o?.onBytes?.(n); during.abort(); } });
    expect(await downloadModel('m', collect().send, { endpoint: hub.url, signal: during.signal })).toBe('cancelled');
  });

  it('a catalog card downloads its pinned file', async () => {
    const [repo, file] = ['handy-computer/whisper-base-gguf', 'whisper-base-Q8_0.gguf'];
    hub.addFile(repo, file, Buffer.alloc(2048, 7));
    const { sent, send } = collect();
    expect(await downloadModel('whisper-base', send, { endpoint: hub.url })).toBe('ready');
    expect(cachedFilePath(repo, file)).not.toBeNull();
    const total = modelSize('whisper-base')!;
    expect(progressOf(sent).at(-1)).toEqual([total, total]);           // the catalog's size is the total
  });
});
