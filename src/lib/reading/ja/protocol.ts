import type { JaToken } from './furigana';

export type ToLinderaWorker =
  | { type: 'init'; wasm: ArrayBuffer }
  | { type: 'tokenize'; id: number; text: string };

export type FromLinderaWorker =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'tokens'; id: number; tokens: JaToken[] | null };
