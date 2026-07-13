/**
 * Correlates worker responses to their awaiting callers by request id.
 * Extracted from TranslationEngine's hand-rolled `pendingRequests` map so the
 * id→{resolve,reject} bookkeeping (and reject-all-on-dispose) lives in one
 * tested place. Settled entries are removed so `size` reflects only in-flight
 * requests.
 */
export class RequestRegistry<T> {
  private readonly pending = new Map<string, { resolve: (v: T) => void; reject: (e: Error) => void }>();

  /** Register a request id and return a promise settled by resolve()/reject(). */
  create(id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  resolve(id: string, value: T): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.resolve(value);
  }

  reject(id: string, error: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.reject(error);
  }

  /** Reject every in-flight request (used on dispose) and clear the map. */
  rejectAll(error: Error): void {
    for (const [, entry] of this.pending) entry.reject(error);
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
