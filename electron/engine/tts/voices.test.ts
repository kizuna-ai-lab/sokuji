// @vitest-environment node
/** The built-in voice listing (ported from sidecar/tests/test_tts_voices.py). */
import '../test/env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listBuiltinVoices, restoreVoicesSeams, voicesSeams } from './voices';

const engine = (modelId: string, voices: string[], isLoaded = true) => ({ modelId, isLoaded, listBuiltinVoices: () => voices });
const card = (family: string, artifact = 'acme/repo/pocket_tts-en/model.gguf') => ({ family, deployments: [{ artifact }] });
const SUPERTONIC = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];

let tmp: string | null = null;
const tmpDir = () => (tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-voices-')));

afterEach(() => {
  restoreVoicesSeams();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe('listBuiltinVoices', () => {
  it('asks the loaded model when it is the card asked about', async () => {
    expect(await listBuiltinVoices('pocket-tts-en', engine('pocket-tts-en', ['alba', 'azelma']))).toEqual(['alba', 'azelma']);
  });

  it('another card falls through to the catalog', async () => {
    voicesSeams.ttsModel = () => null;
    expect(await listBuiltinVoices('supertonic-3', engine('pocket-tts-en', ['alba']))).toEqual([]);
  });

  it('no card named: whatever is loaded; nothing loaded: none', async () => {
    expect(await listBuiltinVoices(null, engine('moss-tts-nano', ['Ava', 'Bella']))).toEqual(['Ava', 'Bella']);
    expect(await listBuiltinVoices(null, null)).toEqual([]);
  });

  it('supertonic: the fixed names, without the snapshot or even a deployment', async () => {
    voicesSeams.scopedSnapshotDir = () => { throw new Error("supertonic's listing must not touch the snapshot"); };
    voicesSeams.ttsModel = () => card('supertonic', 'acme/repo/supertonic/model.gguf');
    expect(await listBuiltinVoices('supertonic-3')).toEqual(SUPERTONIC);
    voicesSeams.ttsModel = () => ({ family: 'supertonic', deployments: [] });
    expect(await listBuiltinVoices('supertonic-3')).toEqual(SUPERTONIC);
  });

  it("pocket_tts: the embeddings beside the card's GGUF, sorted", async () => {
    voicesSeams.ttsModel = () => card('pocket_tts');
    const root = tmpDir();
    const dir = path.join(root, 'pocket_tts-en', 'embeddings');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['azelma.safetensors', 'alba.safetensors', 'notes.txt']) fs.writeFileSync(path.join(dir, f), '');
    voicesSeams.scopedSnapshotDir = () => root;
    expect(await listBuiltinVoices('pocket-tts-en')).toEqual(['alba', 'azelma']);
  });

  it('looks in the repo for the scoped directory', async () => {
    voicesSeams.ttsModel = () => card('pocket_tts', 'acme/pocket-repo/pocket_tts-en/model.gguf');
    const seen: string[][] = [];
    voicesSeams.scopedSnapshotDir = (repo, subdir) => { seen.push([repo, subdir]); return null; };
    expect(await listBuiltinVoices('pocket-tts-en')).toEqual([]);
    expect(seen).toEqual([['acme/pocket-repo', 'pocket_tts-en/embeddings']]);
  });

  it('none for a family without a load-free listing, no deployment, no snapshot, or no voices directory', async () => {
    for (const family of ['moss_tts_nano', 'qwen3_tts', 'omnivoice', '']) {
      voicesSeams.ttsModel = () => card(family);
      expect(await listBuiltinVoices('some-model')).toEqual([]);
    }
    voicesSeams.ttsModel = () => ({ family: 'pocket_tts', deployments: [] });
    expect(await listBuiltinVoices('pocket-tts-en')).toEqual([]);
    voicesSeams.ttsModel = () => card('pocket_tts');
    voicesSeams.scopedSnapshotDir = () => null;
    expect(await listBuiltinVoices('pocket-tts-en')).toEqual([]);
    const root = tmpDir();
    voicesSeams.scopedSnapshotDir = () => root;
    expect(await listBuiltinVoices('pocket-tts-en')).toEqual([]);
  });
});
