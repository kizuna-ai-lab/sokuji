import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  addVoice, listVoices, getVoice, renameVoice, deleteVoice, resetVoiceStorageForTesting,
  VoiceImportError,
} from './voiceStorage';

function makeFile(name: string, contents: object): File {
  return new File([JSON.stringify(contents)], name, { type: 'application/json' });
}

const VALID_JSON = {
  style_ttl: { data: [[[0.1, 0.2]]], dims: [1, 1, 2] },
  style_dp:  { data: [[[0.3, 0.4]]], dims: [1, 1, 2] },
};

describe('voiceStorage', () => {
  beforeEach(async () => { await resetVoiceStorageForTesting(); });
  afterEach(async () => { await resetVoiceStorageForTesting(); });

  it('addVoice persists a record with the expected fields', async () => {
    const file = makeFile('my-voice.json', VALID_JSON);
    const v = await addVoice('supertonic-3', 'My Voice', file);
    expect(v.id).toBeGreaterThan(0);
    expect(v.engine).toBe('supertonic-3');
    expect(v.name).toBe('My Voice');
    expect(v.jsonData).toBeInstanceOf(Blob);
    expect(typeof v.importedAt).toBe('number');
  });

  it('listVoices returns all voices for the given engine', async () => {
    await addVoice('supertonic-3', 'A', makeFile('a.json', VALID_JSON));
    await addVoice('supertonic-3', 'B', makeFile('b.json', VALID_JSON));
    const list = await listVoices('supertonic-3');
    expect(list).toHaveLength(2);
  });

  it('addVoice with a duplicate name appends "(2)"', async () => {
    await addVoice('supertonic-3', 'Sarah', makeFile('a.json', VALID_JSON));
    const v2 = await addVoice('supertonic-3', 'Sarah', makeFile('b.json', VALID_JSON));
    expect(v2.name).toBe('Sarah (2)');
    const v3 = await addVoice('supertonic-3', 'Sarah', makeFile('c.json', VALID_JSON));
    expect(v3.name).toBe('Sarah (3)');
  });

  it('renameVoice updates the name without changing the id', async () => {
    const v = await addVoice('supertonic-3', 'Old', makeFile('a.json', VALID_JSON));
    await renameVoice(v.id, 'New');
    const updated = await getVoice(v.id);
    expect(updated!.name).toBe('New');
    expect(updated!.id).toBe(v.id);
  });

  it('deleteVoice removes the record and does not shift other ids', async () => {
    const a = await addVoice('supertonic-3', 'A', makeFile('a.json', VALID_JSON));
    const b = await addVoice('supertonic-3', 'B', makeFile('b.json', VALID_JSON));
    await deleteVoice(a.id);
    expect(await getVoice(a.id)).toBeUndefined();
    expect(await getVoice(b.id)).toBeDefined();
    const c = await addVoice('supertonic-3', 'C', makeFile('c.json', VALID_JSON));
    expect(c.id).toBeGreaterThan(b.id);  // autoincrement does not reuse a.id
  });
});

describe('voiceStorage validation', () => {
  beforeEach(async () => { await resetVoiceStorageForTesting(); });

  it('rejects files larger than 1 MB', async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.json', { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', big))
      .rejects.toMatchObject({ code: 'too_large' });
  });

  it('rejects non-JSON content', async () => {
    const f = new File(['this is not json'], 'bad.json', { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', f))
      .rejects.toMatchObject({ code: 'not_json' });
  });

  it('rejects JSON missing style_ttl', async () => {
    const f = new File([JSON.stringify({ style_dp: { data: [], dims: [] } })], 'x.json',
                       { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', f))
      .rejects.toMatchObject({ code: 'missing_field' });
  });

  it('rejects JSON missing style_dp', async () => {
    const f = new File([JSON.stringify({ style_ttl: { data: [], dims: [] } })], 'x.json',
                       { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', f))
      .rejects.toMatchObject({ code: 'missing_field' });
  });

  it('rejects JSON without dims arrays', async () => {
    const f = new File([JSON.stringify({
      style_ttl: { data: [] }, style_dp: { data: [] },
    })], 'x.json', { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', f))
      .rejects.toMatchObject({ code: 'invalid_shape' });
  });

  it('VoiceImportError is a class with a code', async () => {
    try {
      const f = new File(['nope'], 'x.json', { type: 'application/json' });
      await addVoice('supertonic-3', 'X', f);
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceImportError);
    }
  });
});
