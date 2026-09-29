/**
 * A WebSocket an adapter test drives by hand (F9). The adapter opens it
 * through the factory it was handed in place of `new WebSocket`; the test
 * opens it, feeds it the server's frames, and reads what the adapter sent.
 * The browser's order holds: nothing before `open`; a close — the
 * adapter's, the server's or a dropped connection's — fires `close` once,
 * on a microtask as a browser queues it, and nothing after it; an adapter
 * closing a socket that never opened fails it (`error`, then an unclean
 * 1006), and a close code or reason a browser refuses throws as a browser
 * does, whatever the socket's state; a server's close frame is a clean
 * close for almost any code (1006 stays unclean here, unresolved: see
 * `serverClose`'s own comment); a binary frame arrives as `binaryType`
 * asks. Test-only: nothing but a test imports `src/lib/contract/testing`.
 */
export type SocketData = string | ArrayBufferLike | Blob | ArrayBufferView;

const STATES = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;

export class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState: number = FakeSocket.CONNECTING;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  extensions = '';
  /** The subprotocol the server chose: `open(protocol)`'s. */
  protocol = '';
  onopen: ((this: FakeSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: FakeSocket, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: FakeSocket, ev: Event) => unknown) | null = null;
  onclose: ((this: FakeSocket, ev: CloseEvent) => unknown) | null = null;
  /** What the adapter sent while the socket was open, in order. */
  readonly sent: SocketData[] = [];
  /** The adapter's own `close()`, when it called it, with the code and reason it gave. */
  closedByClient: { code?: number; reason?: string } | null = null;

  constructor(readonly url: string, readonly protocols: string | string[] | undefined) {
    super();
  }

  send(data: SocketData): void {
    if (this.readyState === FakeSocket.CONNECTING) {
      throw new DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", 'InvalidStateError');
    }
    // Closing or closed: a browser drops it silently.
    if (this.readyState !== FakeSocket.OPEN) return;
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    // A browser refuses these before anything else (the kit's parked item; Stage 2 Palabra, ruling 15): a code only 1000 or 3000–4999, a reason of at most 123 bytes.
    if (code !== undefined && code !== 1000 && !(code >= 3000 && code <= 4999)) {
      throw new DOMException(`Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`, 'InvalidAccessError');
    }
    if (reason !== undefined && new TextEncoder().encode(reason).length > 123) {
      throw new DOMException("Failed to execute 'close' on 'WebSocket': The close reason must not be greater than 123 UTF-8 bytes.", 'SyntaxError');
    }
    if (this.readyState >= FakeSocket.CLOSING) return;
    this.closedByClient = { code, reason };
    // Before `open` a browser fails the connection: `error`, then an unclean 1006, whatever code was asked.
    if (this.readyState === FakeSocket.CONNECTING) this.closing(1006, '', false, true);
    else this.closing(code ?? 1005, reason ?? '', true);
  }

  /** The server accepts the upgrade: `open`, with the subprotocol it chose. */
  open(protocol = ''): void {
    if (this.readyState !== FakeSocket.CONNECTING) throw new Error(`open() on a socket that is ${STATES[this.readyState]}`);
    this.readyState = FakeSocket.OPEN;
    this.protocol = protocol;
    this.fire(new Event('open'));
  }

  /** A frame from the server. A binary one arrives as `binaryType` asks: a Blob (the browser's default), or the ArrayBuffer. */
  receive(data: string | ArrayBuffer): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error(`receive() on a socket that is ${STATES[this.readyState]}`);
    const delivered = typeof data === 'string' || this.binaryType === 'arraybuffer' ? data : new Blob([data]);
    this.fire(new MessageEvent('message', { data: delivered }));
  }

  /**
   * The server closes the connection with a close frame: a clean close for
   * every code that could actually arrive in one — 1008, Palabra's rate
   * limit, included; a browser never reports a code it read from a frame as
   * unclean. 1005 is the empty close frame: no status code at all, so a
   * browser reports it with an empty reason whatever `reason` was asked
   * for. 1004, 1015 and 1016–2999 never travel in a frame either, so they
   * throw: the test is wrong (the kit's parked item; Stage 2 Palabra,
   * ruling 15). 1006 is left unclean here too, unlike a literal browser
   * (which never reads 1006 from a frame — it reports 1006 itself, for a
   * drop it saw with no frame at all): several provider suites already call
   * `serverClose(1006, …)` to mean exactly "the connection closed
   * abnormally", so throwing there is a controller decision, not this
   * fix's (Minor 1, reported, not applied to 1006).
   */
  serverClose(code = 1000, reason = ''): void {
    if (code === 1004 || code === 1015 || (code >= 1016 && code <= 2999) || !(code >= 1000 && code <= 4999)) {
      throw new Error(`serverClose(${code}): no browser reports that close code`);
    }
    if (this.readyState >= FakeSocket.CLOSING) return;
    this.closing(code, code === 1005 ? '' : reason, code !== 1006);
  }

  /** The connection drops: `error`, then an unclean `close` 1006. */
  drop(): void {
    if (this.readyState >= FakeSocket.CLOSING) return;
    this.fire(new Event('error'));
    this.closing(1006, '', false);
  }

  /** Every text frame sent, parsed as JSON; binary frames are skipped. */
  sentJson<T = unknown>(): T[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as T);
  }

  private closing(code: number, reason: string, wasClean: boolean, failed = false): void {
    this.readyState = FakeSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = FakeSocket.CLOSED;
      if (failed) this.fire(new Event('error'));
      this.fire(new CloseEvent('close', { code, reason, wasClean }));
    });
  }

  private fire(event: Event): void {
    const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`];
    if (typeof handler === 'function') (handler as (ev: Event) => unknown).call(this, event);
    this.dispatchEvent(event);
  }
}

export interface FakeSockets {
  /** What an adapter is handed in place of `new WebSocket(url, protocols)`. */
  readonly create: (url: string | URL, protocols?: string | string[]) => WebSocket;
  /** Every socket created so far, oldest first. */
  readonly all: readonly FakeSocket[];
  /** The newest; throws when none was created. */
  last(): FakeSocket;
}

export function fakeSockets(): FakeSockets {
  const all: FakeSocket[] = [];
  return {
    create: (url, protocols) => {
      const socket = new FakeSocket(String(url), protocols);
      all.push(socket);
      return socket as unknown as WebSocket;
    },
    all,
    last() {
      const socket = all[all.length - 1];
      if (!socket) throw new Error('no socket was created');
      return socket;
    },
  };
}
