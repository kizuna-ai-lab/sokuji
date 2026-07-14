import type { ISidecarConnection } from './SidecarConnection';
import type { ServerMsg } from './nativeProtocol';

/**
 * In-memory ISidecarConnection for client tests. Tests drive it with emit()/
 * emitBinary()/emitClose() and inspect sent[]/binarySent[]. Mirrors the real
 * connection's routing: a JSON message whose id matches a pending request()
 * settles it; otherwise it goes to the onMessage hook.
 */
export class FakeSidecarConnection implements ISidecarConnection {
  sent: any[] = [];
  binarySent: ArrayBuffer[] = [];
  disposed = false;
  private counter = 0;
  private pending = new Map<number, { resolve: (m: ServerMsg) => void; reject: (e: Error) => void }>();
  private messageCb: ((m: ServerMsg) => void) | null = null;
  private binaryCb: ((b: ArrayBuffer) => void) | null = null;
  private closeCb: ((e: Error) => void) | null = null;

  async connect(): Promise<void> { /* no-op: always "connected" */ }
  nextId(): number { return ++this.counter; }
  onMessage(cb: (m: ServerMsg) => void): void { this.messageCb = cb; }
  onBinary(cb: (b: ArrayBuffer) => void): void { this.binaryCb = cb; }
  onClose(cb: (e: Error) => void): void { this.closeCb = cb; }

  request(payload: { type: string; [k: string]: unknown }, opts?: { timeoutMs?: number; id?: number }): Promise<ServerMsg> {
    const id = opts?.id ?? this.nextId();
    this.sent.push({ ...payload, id });
    return new Promise<ServerMsg>((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
  }

  send(payload: object): void { this.sent.push(payload); }
  sendBinary(buf: ArrayBuffer): void { this.binarySent.push(buf); }

  /** Simulate a JSON message from the sidecar. */
  emit(msg: ServerMsg): void {
    const id = (msg as { id?: number }).id;
    if (typeof id === 'number' && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      if (msg.type === 'error') p.reject(new Error((msg as { message: string }).message));
      else p.resolve(msg);
      return;
    }
    this.messageCb?.(msg);
  }

  /** Simulate an inbound binary frame. */
  emitBinary(buf: ArrayBuffer): void { this.binaryCb?.(buf); }

  /** Simulate an unexpected socket close. */
  emitClose(): void {
    const err = new Error('native host disconnected');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.closeCb?.(err);
  }

  dispose(): void {
    this.disposed = true;
    const err = new Error('native host disconnected');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
