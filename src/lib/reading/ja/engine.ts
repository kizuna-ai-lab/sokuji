import { TokenizerBuilder, loadDictionaryFromBytes, type Tokenizer } from 'lindera-wasm';
import { dictionaryBytesInOrder, extractDictionary } from './dictionaryZip';
import type { JaToken } from './furigana';

/** A token as lindera-wasm 6 returns it: a plain object, not a handle to free. */
export interface LinderaToken {
  surface: string;
  details: string[];
  isUnknown: boolean;
}

/** The tokenizer as the worker sees it: a row's surfaces and their IPADIC readings. */
export interface JaEngine {
  tokenize(text: string): JaToken[];
}

/** IPADIC's details: part of speech ×4, conjugation ×2, base form, reading, pronunciation. Only the reading is used. */
const READING = 7;

export function toJaTokens(tokens: LinderaToken[]): JaToken[] {
  return tokens.map((t) => {
    const reading = t.details[READING];
    return { surface: t.surface, reading: reading && reading !== '*' ? reading : null, unknown: t.isUnknown };
  });
}

/**
 * Builds the tokenizer on the dictionary archive's bytes (dictionaryZip.ts). The
 * wasm must be initialised first (lindera-wasm's `init`); the dictionary is copied
 * into its memory, so the archive and the inflated files are garbage afterwards.
 */
export async function startEngine(dictionaryZip: ArrayBuffer): Promise<JaEngine> {
  const files = await extractDictionary(dictionaryZip);
  const dictionary = loadDictionaryFromBytes(...dictionaryBytesInOrder(files));
  const builder = new TokenizerBuilder();
  builder.setDictionaryInstance(dictionary);
  builder.setMode('normal');
  const tokenizer: Tokenizer = builder.build();
  return { tokenize: (text) => toJaTokens(tokenizer.tokenize(text) as LinderaToken[]) };
}
