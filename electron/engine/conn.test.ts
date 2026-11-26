// @vitest-environment node
import '../engine/test/env';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Conn } from './conn';

/** A socket whose send() completes only when the test lets it. */
class SlowSocket extends EventEmitter {
  readyState = 1;
  sent: Array<string | Uint8Array> = [];
  pending: Array<() => void> = [];
  send(data: string | Uint8Array, cb?: (err?: Error) => void) {
    this.sent.push(data);
    this.pending.push(() => cb?.());
  }
  releaseAll = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 0));
      while (this.pending.length) this.pending.shift()!();
    }
  };
}

describe('Conn.send', () => {
  it('keeps each binary frame next to its own JSON when two sends overlap', async () => {
    const socket = new SlowSocket();
    const conn = new Conn(socket as never);
    const a = conn.send({ type: 'ok', id: 'a' }, new Uint8Array([1]));
    const b = conn.send({ type: 'ok', id: 'b' }, new Uint8Array([2]));
    await socket.releaseAll();
    await Promise.all([a, b]);
    const order = socket.sent.map((s) => (typeof s === 'string' ? JSON.parse(s).id : `bin${(s as Uint8Array)[0]}`));
    expect(order).toEqual(['bin1', 'a', 'bin2', 'b']);
  });

  it('a failed send does not block the ones queued behind it', async () => {
    const socket = new SlowSocket();
    const conn = new Conn(socket as never);
    socket.send = (data: string | Uint8Array, cb?: (err?: Error) => void) => {
      socket.sent.push(data);
      cb?.(socket.sent.length === 1 ? new Error('boom') : undefined);
    };
    await expect(conn.send({ type: 'ok', id: 'x' })).rejects.toThrow('boom');
    await expect(conn.send({ type: 'ok', id: 'y' })).resolves.toBeUndefined();
  });
});
