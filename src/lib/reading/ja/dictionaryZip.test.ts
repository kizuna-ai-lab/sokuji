// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { DICTIONARY_FILE_NAMES, dictionaryBytesInOrder, extractDictionary } from './dictionaryZip';

const enc = new TextEncoder();
const files = () => Object.fromEntries(DICTIONARY_FILE_NAMES.map((n, i) => [n, enc.encode(`${n} ${'x'.repeat(i * 7)}`)]));
const nested = (f: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(f).map(([n, d]) => [`lindera-ipadic/${n}`, d]));

/** A zip the way Lindera's release archives are laid out: local headers, central directory, end record. */
function makeZip(entries: Record<string, Uint8Array>, opts: { stored?: boolean; declaredSize?: Record<string, number>; declaredCompressedSize?: Record<string, number> } = {}): ArrayBuffer {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameBytes = enc.encode(name);
    const method = opts.stored || data.length === 0 ? 0 : 8;
    const comp = method === 0 ? data : new Uint8Array(deflateRawSync(data));
    const declared = opts.declaredSize?.[name] ?? data.length;
    const declaredCompressed = opts.declaredCompressedSize?.[name] ?? comp.length;
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, declared, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, declaredCompressed, true);
    cv.setUint32(24, declared, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    parts.push(local, comp);
    central.push(cd);
    offset += local.length + comp.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let p = 0;
  for (const part of all) {
    out.set(part, p);
    p += part.length;
  }
  return out.buffer;
}

describe('extractDictionary', () => {
  it("extracts the nine dictionary files by name from under the archive's directory, leaving the notice", async () => {
    const f = files();
    const zip = makeZip({ 'lindera-ipadic/': new Uint8Array(0), ...nested(f), 'lindera-ipadic/NOTICE.txt': enc.encode('IPADIC notice') });
    const dict = await extractDictionary(zip);
    expect(dict).toEqual({
      metadata: f['metadata.json'],
      dictTrie: f['dict.trie'],
      dictValsIdx: f['dict.valsidx'],
      dictVals: f['dict.vals'],
      dictWordsIdx: f['dict.wordsidx'],
      dictWords: f['dict.words'],
      matrixMtx: f['matrix.mtx'],
      charDef: f['char_def.bin'],
      unk: f['unk.bin'],
    });
  });

  it('reads an entry stored without compression as it is', async () => {
    const f = files();
    const dict = await extractDictionary(makeZip(nested(f), { stored: true }));
    expect(dict.dictWords).toEqual(f['dict.words']);
  });

  it('rejects an archive missing a dictionary file, naming it', async () => {
    const f = files();
    delete f['matrix.mtx'];
    await expect(extractDictionary(makeZip(nested(f)))).rejects.toThrow(/matrix\.mtx/);
  });

  it('rejects an entry that inflates to another size than the archive declares', async () => {
    const zip = makeZip(nested(files()), { declaredSize: { 'lindera-ipadic/dict.vals': 999 } });
    await expect(extractDictionary(zip)).rejects.toThrow(/dict\.vals/);
  });

  it('ignores an entry named like a property every object has', async () => {
    const f = files();
    const zip = makeZip({ ...nested(f), 'lindera-ipadic/constructor': enc.encode('x'), 'lindera-ipadic/toString': enc.encode('y') });
    expect(await extractDictionary(zip)).toEqual({
      metadata: f['metadata.json'],
      dictTrie: f['dict.trie'],
      dictValsIdx: f['dict.valsidx'],
      dictVals: f['dict.vals'],
      dictWordsIdx: f['dict.wordsidx'],
      dictWords: f['dict.words'],
      matrixMtx: f['matrix.mtx'],
      charDef: f['char_def.bin'],
      unk: f['unk.bin'],
    });
  });

  it('rejects an entry whose data runs past the end of the archive', async () => {
    const zip = makeZip(nested(files()), { declaredCompressedSize: { 'lindera-ipadic/dict.words': 999_999 } });
    await expect(extractDictionary(zip)).rejects.toThrow(/dict\.words.*past the end/);
  });

  it('rejects a ZIP64 entry, which the archives Lindera releases never need', async () => {
    const zip = makeZip(nested(files()), { declaredSize: { 'lindera-ipadic/dict.trie': 0xffffffff } });
    await expect(extractDictionary(zip)).rejects.toThrow(/dict\.trie.*ZIP64/);
  });

  it('rejects bytes that are not a zip', async () => {
    await expect(extractDictionary(new Uint8Array(100).fill(1).buffer)).rejects.toThrow(/zip/i);
  });
});

describe('dictionaryBytesInOrder', () => {
  it("lists the files in the order Lindera's loadDictionaryFromBytes takes them", async () => {
    const f = files();
    const dict = await extractDictionary(makeZip(nested(f)));
    expect(dictionaryBytesInOrder(dict)).toEqual([
      f['metadata.json'], f['dict.trie'], f['dict.valsidx'], f['dict.vals'], f['dict.wordsidx'], f['dict.words'], f['matrix.mtx'], f['char_def.bin'], f['unk.bin'],
    ]);
  });
});
