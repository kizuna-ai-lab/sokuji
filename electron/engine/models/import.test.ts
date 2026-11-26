// @vitest-environment node
/**
 * Importing files the person downloaded themselves: they land in the hub cache as a download would leave them (blob
 * named by sha256, snapshot link, main ref), so the model reads "ready" and a later download finds the blob; and a
 * wrong, misnamed or damaged file never reaches the cache.
 */
import '../test/env';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshHfHome } from '../test/hfFixture';
import { cachedFilePath, repoDir, resolveRevision, writeRef, writeSnapshotLink } from './hfCache';
import { importModel, knownFile, ImportError } from './import';
import { downloadSpecs } from './specs';
import { modelStatus } from './status';

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const str = (x: string) => { const b = Buffer.from(x, 'utf8'); return Buffer.concat([u64(b.length), b]); };
/** A GGUF with a readable header and some body bytes. */
const gguf = (body = 2000) => Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(1), str('general.architecture'), u32(8), str('qwen2'), Buffer.alloc(body, 7)]);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let cleanup: () => void;
let work: string;
let sent: Array<Record<string, unknown>>;
const send = async (m: Record<string, unknown>) => { sent.push(m); };
const put = (name: string, content: Buffer): string => {
  const p = path.join(work, name);
  fs.writeFileSync(p, content);
  return p;
};

beforeEach(() => {
  cleanup = freshHfHome();
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'sokuji-import-'));
  sent = [];
});
afterEach(() => {
  cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

// A translation card: its file is not in the published catalog, so only its name and header are checked.
const CARD = 'qwen2.5-0.5b';
const [[REPO, FILE]] = downloadSpecs(CARD).files!;

describe('importModel', () => {
  it('puts the file in the cache as a download would, and the model reads ready', async () => {
    const content = gguf();
    const from = put(path.basename(FILE), content);
    expect(modelStatus(CARD)).toBe('absent');
    expect(await importModel(CARD, [from], send)).toBe('ready');
    expect(modelStatus(CARD)).toBe('ready');
    const blob = path.join(repoDir(REPO), 'blobs', sha256(content));
    expect(fs.readFileSync(blob).equals(content)).toBe(true);
    expect(fs.readFileSync(cachedFilePath(REPO, FILE)!).equals(content)).toBe(true);
    expect(fs.existsSync(`${blob}.incomplete`)).toBe(false);
    // The progress ends exactly at its total.
    const last = sent[sent.length - 1];
    expect(last).toMatchObject({ type: 'model_progress', model: CARD });
    expect(last.downloaded).toBe(last.total);
  });

  it('leaves the person\'s file where it was', async () => {
    const from = put(path.basename(FILE), gguf());
    await importModel(CARD, [from], send);
    expect(fs.existsSync(from)).toBe(true);
  });

  it('says which file is missing, and puts nothing in the cache', async () => {
    const other = put('something-else.gguf', gguf());
    await expect(importModel(CARD, [other], send)).rejects.toThrow(`missing: ${path.basename(FILE)}`);
    // Coded, so the interface can say it in its own language.
    await expect(importModel(CARD, [other], send)).rejects.toMatchObject({ code: 'import_missing', params: { names: path.basename(FILE) } });
    expect(modelStatus(CARD)).toBe('absent');
    expect(fs.existsSync(repoDir(REPO))).toBe(false);
  });

  it('refuses a file that is not a GGUF, or was cut short', async () => {
    const name = path.basename(FILE);
    await expect(importModel(CARD, [put(name, Buffer.from('<html>not a model</html>'))], send)).rejects.toMatchObject({ message: `${name} is not a GGUF file`, code: 'import_not_gguf', params: { name } });
    await expect(importModel(CARD, [put(name, gguf().subarray(0, 30))], send)).rejects.toBeInstanceOf(ImportError);
    expect(modelStatus(CARD)).toBe('absent');
  });

  it('refuses an empty file and a folder', async () => {
    const name = path.basename(FILE);
    await expect(importModel(CARD, [put(name, Buffer.alloc(0))], send)).rejects.toThrow('is not a readable file');
    const dir = path.join(work, 'dir', name);
    fs.mkdirSync(dir, { recursive: true });
    await expect(importModel(CARD, [dir], send)).rejects.toThrow('is not a readable file');
  });

  it('refuses a model that is not a single published file', async () => {
    await expect(importModel('acme/some-whole-repo', [put('x.gguf', gguf())], send)).rejects.toThrow('cannot be imported');
  });

  it('checks a file the published catalog lists against its hash, and refuses another file of that name', async () => {
    const [[repo, file]] = downloadSpecs('cohere-transcribe-03-2026').files!;
    expect(knownFile(repo, file)?.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(importModel('cohere-transcribe-03-2026', [put(path.basename(file), gguf())], send)).rejects.toMatchObject({ code: 'import_mismatch', params: { name: path.basename(file) } });
    expect(fs.existsSync(repoDir(repo))).toBe(false);
  });

  it('stops when cancelled, leaving no half-written blob', async () => {
    const from = put(path.basename(FILE), gguf(3_000_000));
    const controller = new AbortController();
    controller.abort();
    expect(await importModel(CARD, [from], send, { signal: controller.signal })).toBe('cancelled');
    expect(modelStatus(CARD)).toBe('absent');
  });

  it('is a no-op for bytes already in the cache: the blob is reused', async () => {
    const content = gguf();
    const from = put(path.basename(FILE), content);
    await importModel(CARD, [from], send);
    const blob = path.join(repoDir(REPO), 'blobs', sha256(content));
    const before = fs.statSync(blob).ino;
    await importModel(CARD, [from], send);
    expect(fs.statSync(blob).ino).toBe(before);
    expect(modelStatus(CARD)).toBe('ready');
  });

  // Review on #888: each file of a model got a commit of its own and `main` ended on the last, so the others no longer
  // resolved. A speech card with a preset is two files of one repo the published catalog does not list.
  const TTS = 'pocket-tts-en';
  const ttsFiles = () => downloadSpecs(TTS).files!;
  const putAll = () => ttsFiles().map(([, file]) => put(path.posix.basename(file), file.endsWith('.gguf') ? gguf() : Buffer.from(`preset ${file}`)));

  it('files every file of one import under one snapshot, so each of them resolves', async () => {
    expect(ttsFiles().length).toBeGreaterThan(1);
    expect(await importModel(TTS, putAll(), send)).toBe('ready');
    for (const [repo, file] of ttsFiles()) expect(cachedFilePath(repo, file)).not.toBeNull();
    expect(modelStatus(TTS)).toBe('ready');
  });

  it("adds to the snapshot the repo's main already names, so files already there keep resolving", async () => {
    const [[repo]] = ttsFiles();
    const commit = 'a'.repeat(40);
    const other = Buffer.from('another file of the repo');
    fs.mkdirSync(path.join(repoDir(repo), 'blobs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir(repo), 'blobs', sha256(other)), other);
    writeSnapshotLink(repo, commit, 'other.bin', sha256(other));
    writeRef(repo, 'main', commit);
    expect(await importModel(TTS, putAll(), send)).toBe('ready');
    expect(resolveRevision(repo)).toBe(commit);
    expect(cachedFilePath(repo, 'other.bin')).not.toBeNull();
    for (const [r, file] of ttsFiles()) expect(cachedFilePath(r, file)).not.toBeNull();
  });

  // Review on #888: the file was hashed in one read and copied in another, so bytes changed in between reached the
  // cache under the name of the bytes checked. The cache must hold the very bytes that were hashed.
  it('caches the bytes it hashed, even if the file changes while it is imported', async () => {
    const content = gguf();
    const from = put(path.basename(FILE), content);
    const real = fs.createReadStream;
    const spy = vi.spyOn(fs, 'createReadStream').mockImplementation(((...args: Parameters<typeof fs.createReadStream>) => {
      const stream = real(...args);
      // Once a full read of the person's file ends, another program rewrites it.
      if (args[0] === from) stream.on('end', () => fs.writeFileSync(from, gguf(3000)));
      return stream;
    }) as typeof fs.createReadStream);
    try {
      expect(await importModel(CARD, [from], send)).toBe('ready');
    } finally {
      spy.mockRestore();
    }
    const cached = fs.readFileSync(cachedFilePath(REPO, FILE)!);
    expect(path.basename(fs.realpathSync(cachedFilePath(REPO, FILE)!))).toBe(sha256(cached));
    expect(cached.equals(content)).toBe(true);
  });
});
