/**
 * One client connection (port of server.py's Conn): its per-connection context, the cleanups each stage registers,
 * and the one outbound funnel every message leaves through.
 */
import { checkOutbound } from './wire';

/** What a connection needs of its socket: `ws`'s WebSocket, or a test's fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string | Uint8Array, cb?: (err?: Error) => void): void;
}

const OPEN = 1;

export class Conn {
  /** Per-connection state a stage keeps (`on_binary`, its own handles). */
  readonly ctx = new Map<string, unknown>();
  private readonly cleanups: Array<() => void | Promise<void>> = [];
  private isClosed = false;
  private settleClosed: () => void = () => {};
  private readonly closedPromise = new Promise<void>((resolve) => { this.settleClosed = resolve; });

  constructor(private readonly socket: SocketLike) {}

  /**
   * Registers a cleanup to run when the connection closes. They run after the handler in flight has returned, in
   * registration order; a cleanup reads the connection's state when it runs, not when it registers.
   */
  onClose(cb: () => void | Promise<void>): void {
    this.cleanups.push(cb);
  }

  /** Resolves as soon as the socket is seen closed, whatever a handler is awaiting. */
  waitClosed(): Promise<void> {
    return this.closedPromise;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** The socket closed: called by the server. */
  markClosed(): void {
    this.isClosed = true;
    this.settleClosed();
  }

  /** The registered cleanups, for the server to run once the connection has closed. */
  takeCleanups(): Array<() => void | Promise<void>> {
    return this.cleanups.splice(0);
  }

  /**
   * The one outbound funnel: the JSON is checked against the wire contract before anything is sent, then the binary
   * frame goes first and its JSON right after. Nothing is sent on a closed socket.
   */
  async send(obj?: Record<string, unknown> | null, binary?: Uint8Array | null): Promise<void> {
    if (obj) checkOutbound(obj);
    if (this.isClosed || this.socket.readyState !== OPEN) return;
    if (binary) await this.write(binary);
    if (obj) await this.write(JSON.stringify(obj));
  }

  private write(data: string | Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.send(data, (err) => (err ? reject(err) : resolve()));
    });
  }
}
