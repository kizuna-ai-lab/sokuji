/**
 * Lindera's dictionary archive: `lindera-ipadic-<version>.zip` from its GitHub
 * release, served by sokuji-backend and stored by dictionary.ts. It holds the
 * nine files `loadDictionaryFromBytes` takes, in a directory, with IPADIC's
 * NOTICE.txt. Inflated here with the platform's DecompressionStream, so no zip
 * library ships in the build; the layout follows lindera-wasm's own opfs.js.
 */

/** The files, in the order `loadDictionaryFromBytes` takes them. */
export const DICTIONARY_FILE_NAMES = [
  'metadata.json', 'dict.trie', 'dict.valsidx', 'dict.vals', 'dict.wordsidx', 'dict.words', 'matrix.mtx', 'char_def.bin', 'unk.bin',
] as const;

export interface DictionaryFiles {
  metadata: Uint8Array;
  dictTrie: Uint8Array;
  dictValsIdx: Uint8Array;
  dictVals: Uint8Array;
  dictWordsIdx: Uint8Array;
  dictWords: Uint8Array;
  matrixMtx: Uint8Array;
  charDef: Uint8Array;
  unk: Uint8Array;
}

const KEY_OF: Record<(typeof DICTIONARY_FILE_NAMES)[number], keyof DictionaryFiles> = {
  'metadata.json': 'metadata',
  'dict.trie': 'dictTrie',
  'dict.valsidx': 'dictValsIdx',
  'dict.vals': 'dictVals',
  'dict.wordsidx': 'dictWordsIdx',
  'dict.words': 'dictWords',
  'matrix.mtx': 'matrixMtx',
  'char_def.bin': 'charDef',
  'unk.bin': 'unk',
};

export type DictionaryBytes = [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];

/** The files as `loadDictionaryFromBytes(metadata, dictTrie, dictValsIdx, dictVals, dictWordsIdx, dictWords, matrixMtx, charDef, unk)` takes them. */
export function dictionaryBytesInOrder(files: DictionaryFiles): DictionaryBytes {
  return [files.metadata, files.dictTrie, files.dictValsIdx, files.dictVals, files.dictWordsIdx, files.dictWords, files.matrixMtx, files.charDef, files.unk];
}

type DictionaryFileName = (typeof DICTIONARY_FILE_NAMES)[number];

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;
/** A size or offset of this value means the real one is in a ZIP64 extra field; the archives Lindera releases never need one. */
const ZIP64 = 0xffffffff;
const isDictionaryFileName = (name: string): name is DictionaryFileName => Object.prototype.hasOwnProperty.call(KEY_OF, name);

/** A deflated zip entry's bytes, inflated by the platform (raw deflate: zip entries carry no zlib header). */
async function inflate(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The dictionary's nine files out of the archive's bytes. Rejects an archive that is not a zip or lacks a file. */
export async function extractDictionary(zip: ArrayBuffer): Promise<DictionaryFiles> {
  const bytes = new Uint8Array(zip);
  const view = new DataView(zip);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('The dictionary is not a zip archive: no end-of-central-directory record');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const found: Partial<DictionaryFiles> = {};
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error('The dictionary is not a zip archive: bad central directory entry');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    const base = name.split('/').pop() ?? '';
    if (name.endsWith('/') || !isDictionaryFileName(base)) continue;
    if (size === ZIP64 || compressedSize === ZIP64 || local === ZIP64) throw new Error(`${name} in the dictionary archive is a ZIP64 entry, which is not supported`);
    if (local + 30 > bytes.length) throw new Error(`${name} in the dictionary archive runs past the end of the archive`);
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (data + compressedSize > bytes.length) throw new Error(`${name} in the dictionary archive runs past the end of the archive`);
    const compressed = bytes.subarray(data, data + compressedSize);
    let file: Uint8Array;
    if (method === STORED) file = compressed;
    else if (method === DEFLATED) file = await inflate(compressed);
    else throw new Error(`${name} in the dictionary archive uses compression method ${method}, not deflate`);
    if (file.length !== size) throw new Error(`${name} in the dictionary archive is ${file.length} bytes, not the ${size} it declares`);
    found[KEY_OF[base]] = file;
  }
  const missing = DICTIONARY_FILE_NAMES.filter((n) => !(KEY_OF[n] in found));
  if (missing.length > 0) throw new Error(`The dictionary archive lacks ${missing.join(', ')}`);
  return found as DictionaryFiles;
}
