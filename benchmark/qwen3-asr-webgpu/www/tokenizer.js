// Minimal Qwen (GPT-2 byte-level BPE) *decoder*: id -> text. Encoding is not needed
// because the ASR prompt is built from fixed token ids. Reads tokenizer.json.

function bytesToUnicode() {
  const bs = [];
  for (let b = '!'.charCodeAt(0); b <= '~'.charCodeAt(0); b++) bs.push(b);
  for (let b = 0xa1; b <= 0xac; b++) bs.push(b);
  for (let b = 0xae; b <= 0xff; b++) bs.push(b);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
  }
  const charToByte = new Map();
  for (let i = 0; i < bs.length; i++) charToByte.set(String.fromCharCode(cs[i]), bs[i]);
  return charToByte;
}

export async function loadTokenizer(url) {
  const tj = await (await fetch(url)).json();
  const vocab = tj.model.vocab; // token string -> id
  const idToToken = [];
  for (const [tok, id] of Object.entries(vocab)) idToToken[id] = tok;
  const special = new Map();
  for (const t of tj.added_tokens || []) special.set(t.id, t.content);
  const charToByte = bytesToUnicode();
  const td = new TextDecoder('utf-8');
  return {
    special,
    decode(ids, { skipSpecial = true } = {}) {
      const bytes = [];
      let out = '';
      const flush = () => { if (bytes.length) { out += td.decode(new Uint8Array(bytes)); bytes.length = 0; } };
      for (const id of ids) {
        if (special.has(id)) { flush(); if (!skipSpecial) out += special.get(id); continue; }
        const tok = idToToken[id];
        if (tok === undefined) { flush(); out += `<unk:${id}>`; continue; }
        for (const ch of tok) {
          const b = charToByte.get(ch);
          if (b === undefined) { flush(); out += ch; } else bytes.push(b);
        }
      }
      flush();
      return out;
    },
  };
}
