/**
 * Minimal byte-level BPE *decoder* (id → text) for GPT-2 / Qwen style `tokenizer.json` files.
 *
 * Encoding is not needed by the raw-ORT ASR workers: their prompts are fixed token ids. Decoding
 * only needs the vocabulary (token string → id) and the GPT-2 byte↔unicode table, so this stays
 * a few dozen lines and keeps @huggingface/transformers out of those workers' bundles.
 */

export interface TokenizerJsonLike {
  model: { vocab: Record<string, number> };
  added_tokens?: { id: number; content: string }[];
}

export interface BpeDecoder {
  /** id → content for added (special) tokens. */
  special: Map<number, string>;
  decode(ids: number[], opts?: { skipSpecial?: boolean }): string;
}

/** Inverse of GPT-2's `bytes_to_unicode`: printable stand-in character → original byte. */
function charToByteTable(): Map<string, number> {
  const bs: number[] = [];
  for (let b = '!'.charCodeAt(0); b <= '~'.charCodeAt(0); b++) bs.push(b);
  for (let b = 0xa1; b <= 0xac; b++) bs.push(b);
  for (let b = 0xae; b <= 0xff; b++) bs.push(b);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const table = new Map<string, number>();
  for (let i = 0; i < bs.length; i++) table.set(String.fromCharCode(cs[i]), bs[i]);
  return table;
}

export function createBpeDecoder(tokenizerJson: TokenizerJsonLike): BpeDecoder {
  const idToToken: string[] = [];
  for (const [tok, id] of Object.entries(tokenizerJson.model.vocab)) idToToken[id] = tok;
  const special = new Map<number, string>();
  for (const t of tokenizerJson.added_tokens ?? []) special.set(t.id, t.content);
  const charToByte = charToByteTable();
  const utf8 = new TextDecoder('utf-8');

  return {
    special,
    decode(ids, { skipSpecial = true } = {}) {
      const bytes: number[] = [];
      let out = '';
      const flush = () => {
        if (bytes.length) {
          out += utf8.decode(new Uint8Array(bytes));
          bytes.length = 0;
        }
      };
      for (const id of ids) {
        const sp = special.get(id);
        if (sp !== undefined) {
          flush();
          if (!skipSpecial) out += sp;
          continue;
        }
        const tok = idToToken[id];
        if (tok === undefined) {
          flush();
          out += `<unk:${id}>`;
          continue;
        }
        for (const ch of tok) {
          const b = charToByte.get(ch);
          if (b === undefined) {
            flush();
            out += ch;
          } else {
            bytes.push(b);
          }
        }
      }
      flush();
      return out;
    },
  };
}
