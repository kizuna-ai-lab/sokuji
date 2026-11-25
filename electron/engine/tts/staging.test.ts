// @vitest-environment node
/** Staging TTS files for audio.cpp (ported from sidecar/tests/test_tts_backend.py's staging cases). */
import '../test/env';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshHfHome, hub } from '../test/hfFixture';
import { restoreStagingSeams, stageForNative, stagingSeams } from './staging';

let cleanup: () => void;
let root: string;
beforeEach(() => {
  cleanup = freshHfHome();
  root = path.dirname(hub());
});
afterEach(() => {
  restoreStagingSeams();
  cleanup();
});

const ino = (p: string) => fs.statSync(p, { bigint: true }).ino;
const same = (a: string, b: string) => ino(a) === ino(b);
const write = (rel: string, content: string) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
};

describe('stageForNative', () => {
  it('hard-links, is idempotent, and replaces a stale entry', async () => {
    const source = write('snap/dir/model.gguf', 'real content');
    const staged1 = await stageForNative('acme/repo', 'rev1', 'dir/model.gguf', source);
    expect(staged1).toBe(path.join(hub(), 'sokuji-tts-staging', 'acme--repo__rev1', 'dir', 'model.gguf'));
    expect(same(staged1, source)).toBe(true);
    const first = ino(staged1);
    expect(await stageForNative('acme/repo', 'rev1', 'dir/model.gguf', source)).toBe(staged1);
    expect(ino(staged1)).toBe(first);                                  // untouched the second time
    const other = write('snap/dir2/other.gguf', 'different content');
    fs.rmSync(staged1);
    fs.linkSync(other, staged1);                                       // a stale link to an older blob
    expect(same(await stageForNative('acme/repo', 'rev1', 'dir/model.gguf', source), source)).toBe(true);
  });

  it('links the blob behind a symlinked snapshot entry, never the symlink', async () => {
    const blob = write('cache/blobs/abc123', 'real blob content');
    const link = path.join(root, 'cache', 'snapshots', 'rev1', 'dir', 'model.gguf');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(link), blob), link);
    const staged = await stageForNative('acme/repo', 'rev1', 'dir/model.gguf', link);
    expect(fs.lstatSync(staged).isSymbolicLink()).toBe(false);
    expect(staged.endsWith(path.join('dir', 'model.gguf'))).toBe(true);
    expect(same(staged, blob)).toBe(true);
    expect(fs.readFileSync(staged, 'utf8')).toBe('real blob content');
  });

  it('a link that loses a race to an identical one is kept, with no copy', async () => {
    const source = write('snap/dir/model.gguf', 'real content');
    const realLink = fs.promises.link;
    stagingSeams.link = async (src, dst) => {
      await realLink(src, dst);
      throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
    };
    let copies = 0;
    stagingSeams.copyFile = async () => { copies++; };
    expect(same(await stageForNative('acme/repo', 'rev1', 'dir/model.gguf', source), source)).toBe(true);
    expect(copies).toBe(0);
  });

  it('copies when a hard link is impossible', async () => {
    const source = write('snap/dir/model.gguf', 'fake gguf bytes');
    stagingSeams.link = async () => { throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' }); };
    const staged = await stageForNative('acme/repo', 'rev1', 'dir/model.gguf', source);
    expect(fs.readFileSync(staged, 'utf8')).toBe('fake gguf bytes');
    expect(same(staged, source)).toBe(false);
    expect(fs.readdirSync(path.dirname(staged))).toEqual(['model.gguf']);   // no temporary file left
  });

  it('refuses a path that would leave the staging tree', async () => {
    const source = write('snap/model.gguf', 'x');
    await expect(stageForNative('acme/repo', 'rev1', '../../escape.gguf', source)).rejects.toThrow(/unsafe/);
    await expect(stageForNative('acme/repo', '..', 'model.gguf', source)).rejects.toThrow(/unsafe/);
  });
});
