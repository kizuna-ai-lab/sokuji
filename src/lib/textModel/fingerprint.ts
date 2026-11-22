// src/lib/textModel/fingerprint.ts
//
// A short digest of credential values (53 bits, base 36): enough to tell that a key or an address changed, and no
// way back to them. What the page keeps a key's answers by holds this, never the key (a second copy of it in
// memory). For change detection only: not a hash to protect anything with.

/** The digest of `values`, in order: 11 characters at most. */
export function fingerprint(values: readonly string[]): string {
  const text = JSON.stringify(values);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
