// @vitest-environment node
/**
 * Deleting models from the hub cache (ported from sidecar/tests/test_native_models.py): whole repos for a card's own
 * repo, file by file for a repo several cards share, every rung without a variant, and the TTS staging tree's hard
 * links even when the cache scan fails.
 */
import '../test/env';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TTS_STAGING_DIRNAME, ttsModel } from '../catalog';
import { cacheFile, cacheRepo, freshHfHome, hub } from '../test/hfFixture';
import { repoDir } from './hfCache';
import { deleteModel, pruneStagedRepo, removeSeams, restoreRemoveSeams } from './remove';
import { modelStatus } from './status';

const SHARED = 'audio-cpp/audio.cpp-gguf';
const MOSS = 'MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf';
const MOSS_BF16 = 'MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf';
const SUPER = 'Supertonic-3-GGUF/supertonic-3-f16.gguf';
const QWEN = 'Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf';
const staging = (...p: string[]) => path.join(hub(), TTS_STAGING_DIRNAME, ...p);
const scanFails = () => { removeSeams.scanRepo = () => { throw new Error('cache scan failed'); }; };

let cleanup: () => void;
beforeEach(() => {
  cleanup = freshHfHome();
});
afterEach(() => {
  restoreRemoveSeams();
  cleanup();
});

describe('a repo several cards share', () => {
  it("removes only this card's files", async () => {
    const moss = cacheFile(SHARED, MOSS, 111);
    const sup = cacheFile(SHARED, SUPER, 222);
    const qwen = cacheFile(SHARED, QWEN, 333);
    expect(await deleteModel('moss-tts-nano')).toBe(111);
    expect([fs.existsSync(moss.link), fs.existsSync(moss.blob)]).toEqual([false, false]);
    expect([fs.existsSync(sup.link), fs.existsSync(sup.blob), fs.existsSync(qwen.link), fs.existsSync(qwen.blob)]).toEqual([true, true, true, true]);
  });

  it('keeps a blob another file still points at, and does not count it', async () => {
    const moss = cacheFile(SHARED, MOSS, 555, { blobName: 'blob-shared' });
    const sup = cacheFile(SHARED, SUPER, 555, { blobName: 'blob-shared' });
    expect(await deleteModel('moss-tts-nano')).toBe(0);
    expect(fs.existsSync(moss.link)).toBe(false);
    expect([fs.existsSync(sup.link), fs.existsSync(sup.blob)]).toEqual([true, true]);
  });

  it("removes the card's staged hard links too, and only its own", async () => {
    const moss = cacheFile(SHARED, MOSS, 111);
    const sup = cacheFile(SHARED, SUPER, 222);
    const root = staging('audio-cpp--audio.cpp-gguf__rev1');
    const stagedMoss = path.join(root, ...MOSS.split('/'));
    const stagedSuper = path.join(root, ...SUPER.split('/'));
    fs.mkdirSync(path.dirname(stagedMoss), { recursive: true });
    fs.mkdirSync(path.dirname(stagedSuper), { recursive: true });
    fs.linkSync(moss.blob, stagedMoss);
    fs.linkSync(sup.blob, stagedSuper);
    expect(fs.statSync(moss.blob).nlink).toBe(2);
    expect(await deleteModel('moss-tts-nano')).toBe(111);
    expect([fs.existsSync(moss.link), fs.existsSync(moss.blob), fs.existsSync(stagedMoss)]).toEqual([false, false, false]);
    expect(fs.existsSync(path.dirname(stagedMoss))).toBe(false);                  // the emptied staged directory went too
    expect([fs.existsSync(sup.link), fs.existsSync(sup.blob), fs.existsSync(stagedSuper), fs.existsSync(root)]).toEqual([true, true, true, true]);
  });
});

describe('without a variant, every cached rung goes', () => {
  it('repo unset deletes every rung', async () => {
    const q8 = cacheFile(SHARED, MOSS, 111);
    const bf16 = cacheFile(SHARED, MOSS_BF16, 222);
    expect(modelStatus('moss-tts-nano')).toBe('ready');
    expect(await deleteModel('moss-tts-nano')).toBe(111 + 222);
    expect([q8.link, q8.blob, bf16.link, bf16.blob].map((p) => fs.existsSync(p))).toEqual([false, false, false, false]);
    expect(modelStatus('moss-tts-nano')).toBe('absent');
  });

  it('a named variant deletes only that rung', async () => {
    const q8 = cacheFile(SHARED, MOSS, 111);
    const bf16 = cacheFile(SHARED, MOSS_BF16, 222);
    const bf16Artifact = ttsModel('moss-tts-nano')!.deployments.find((d) => d.computeType === 'bf16')!.artifact;
    expect(await deleteModel('moss-tts-nano', bf16Artifact)).toBe(222);
    expect([fs.existsSync(bf16.link), fs.existsSync(bf16.blob)]).toEqual([false, false]);
    expect([fs.existsSync(q8.link), fs.existsSync(q8.blob)]).toEqual([true, true]);
  });
});

describe('when the cache scan fails', () => {
  it("a shared repo's staged files are still pruned", async () => {
    const staged = staging('audio-cpp--audio.cpp-gguf__rev1', ...MOSS.split('/'));
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.writeFileSync(staged, 'x'.repeat(111));
    scanFails();
    expect(await deleteModel('moss-tts-nano')).toBe(0);
    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.existsSync(staging('audio-cpp--audio.cpp-gguf__rev1'))).toBe(false);
  });

  it("a card's own repo's staging is still pruned", async () => {
    const staged = staging('handy-computer--whisper-base-gguf__rev1', 'whisper-base-Q8_0.gguf');
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.writeFileSync(staged, 'x');
    scanFails();
    expect(await deleteModel('whisper-base')).toBe(0);
    expect(fs.existsSync(path.dirname(staged))).toBe(false);
  });
});

describe("a card's own repo", () => {
  it('prunes every staged revision of that repo only', () => {
    const files = ['acme--repo-a__rev1', 'acme--repo-a__rev2', 'acme--repo-b__rev1'].map((d) => staging(d, 'model.gguf'));
    for (const f of files) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, 'x');
    }
    pruneStagedRepo('acme/repo-a');
    expect(files.map((f) => fs.existsSync(path.dirname(f)))).toEqual([false, false, true]);
  });

  it('goes whole, with its staging, and frees its blobs', async () => {
    const repo = 'handy-computer/whisper-base-gguf';
    cacheFile(repo, 'whisper-base-Q8_0.gguf', 12000);
    cacheFile(repo, 'whisper-base-Q4_K_M.gguf', 345);
    const staged = staging('handy-computer--whisper-base-gguf__rev1', 'whisper-base-Q8_0.gguf');
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.writeFileSync(staged, 'x');
    expect(await deleteModel('whisper-base')).toBe(12345);
    expect(fs.existsSync(repoDir(repo))).toBe(false);
    expect(fs.existsSync(path.dirname(staged))).toBe(false);
  });

  it('a whole-repo variant frees that repo, not the default', async () => {
    cacheFile('tencent/Hy-MT2-7B-FP8', 'model.safetensors', 700);
    const { blobs } = cacheRepo('tencent/Hy-MT2-7B-FP8');
    fs.writeFileSync(path.join(blobs, 'orphan.incomplete'), 'not counted');
    const def = cacheFile('tencent/Hy-MT2-7B', 'model.safetensors', 900);
    expect(await deleteModel('hy-mt2-7b', 'tencent/Hy-MT2-7B-FP8')).toBe(700);
    expect(fs.existsSync(repoDir('tencent/Hy-MT2-7B-FP8'))).toBe(false);
    expect(fs.existsSync(def.blob)).toBe(true);
  });

  it('nothing cached frees nothing', async () => {
    expect(await deleteModel('whisper-base')).toBe(0);
  });
});

describe('an unsafe path', () => {
  it('a variant override that climbs out of the cache deletes nothing', async () => {
    const outside = path.join(hub(), '..', 'outside.txt');
    fs.writeFileSync(outside, 'keep me');
    const staged = staging('audio-cpp--audio.cpp-gguf__rev1', 'x.gguf');
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.writeFileSync(staged, 'x');
    await expect(deleteModel('moss-tts-nano', 'audio-cpp/audio.cpp-gguf/../../../outside.txt')).rejects.toThrow(/unsafe/);
    await expect(deleteModel('moss-tts-nano', 'audio-cpp/audio.cpp-gguf/a\\..\\..\\outside.txt')).rejects.toThrow(/unsafe/);
    await expect(deleteModel('..')).rejects.toThrow(/unsafe/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep me');
    expect(fs.existsSync(staged)).toBe(true);
  });

  it('a status asked with a climbing override is absent', () => {
    cacheFile(SHARED, MOSS, 1);
    expect(modelStatus('moss-tts-nano', `${SHARED}/MOSS-TTS-Nano-100M-GGUF/../${MOSS}`)).toBe('absent');
  });
});

