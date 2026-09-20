/**
 * The order MainPanel renders a conversation in.
 *
 * Extracted from MainPanel's `combinedItems` memo so a client test can assert
 * against the comparator the panel actually uses rather than a copy of it that
 * can drift. `createdAt` is the only key, and `Array.prototype.sort` has been
 * stable since ES2019 — which is the whole reason a client may give every
 * piece of one segment the SAME stamp: contiguous insertion plus a stable sort
 * keeps them together and keeps the next segment after them, while a
 * per-piece `+ i` offset makes piece *i* of one segment collide with piece *i*
 * of the other side's and interleaves the two.
 *
 * Generic in the item so MainPanel keeps the tagged type it feeds in.
 */
export function orderConversationItems<T extends { createdAt?: number }>(
  speakerItems: T[],
  participantItems: T[],
): T[] {
  return [...speakerItems, ...participantItems].sort((a, b) => {
    const aTime = a.createdAt || 0;
    const bTime = b.createdAt || 0;
    return aTime - bTime;
  });
}
