import { describe, it, expect, vi } from 'vitest';
import { FakeSocket, fakeSockets } from './fakeSocket';

describe('FakeSocket', () => {
  it("is connecting until the test opens it, and a send then throws as a browser's does", () => {
    const s = new FakeSocket('wss://x', undefined);
    expect(s.readyState).toBe(FakeSocket.CONNECTING);
    expect(() => s.send('a')).toThrow(DOMException);
  });

  it('opens with the chosen subprotocol, and calls the handler and every listener', () => {
    const s = new FakeSocket('wss://x', undefined);
    const onopen = vi.fn();
    const listener = vi.fn();
    s.onopen = onopen;
    s.addEventListener('open', listener);
    s.open('chat');
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.protocol).toBe('chat');
    expect(s.readyState).toBe(FakeSocket.OPEN);
  });

  it("hands the adapter the server's frames, and keeps what it sent", () => {
    const s = new FakeSocket('wss://x', undefined);
    const onmessage = vi.fn();
    s.onmessage = onmessage;
    s.open();
    s.receive('{"a":1}');
    expect(onmessage.mock.calls[0][0].data).toBe('{"a":1}');

    s.send('{"b":2}');
    s.send(new ArrayBuffer(4));
    expect(s.sent.length).toBe(2);
    expect(s.sentJson()).toEqual([{ b: 2 }]);
  });

  it("closes once, on a microtask, with the adapter's code; a send while closing is dropped", async () => {
    const s = new FakeSocket('wss://x', undefined);
    const onclose = vi.fn();
    s.onclose = onclose;
    s.open();
    s.close(1000, 'bye');
    expect(onclose).not.toHaveBeenCalled();
    expect(s.readyState).toBe(FakeSocket.CLOSING);

    s.send('late');
    expect(s.sent).toEqual([]);

    await Promise.resolve();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onclose.mock.calls[0][0]).toMatchObject({ code: 1000, reason: 'bye', wasClean: true });
    expect(s.closedByClient).toEqual({ code: 1000, reason: 'bye' });

    s.close();
    await Promise.resolve();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it("a server's close frame is clean whatever its code, 1005 (the empty frame) included; 1006 stays unclean, pending Minor 1's controller ruling; a code no browser reports throws; a drop is an error, then an unclean 1006 (Stage 2 Palabra, ruling 15)", async () => {
    const s = new FakeSocket('wss://x', undefined);
    const onclose = vi.fn();
    s.onclose = onclose;
    s.open();
    s.serverClose(1011, 'err');
    await Promise.resolve();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onclose.mock.calls[0][0]).toMatchObject({ code: 1011, reason: 'err', wasClean: true });

    for (const [code, clean, reason] of [[1008, true, 'x'], [4001, true, 'x'], [1005, true, 'ignored'], [1006, false, 'x']] as const) {
      const c = new FakeSocket('wss://c', undefined);
      const seen = vi.fn();
      c.onclose = seen;
      c.open();
      c.serverClose(code, reason);
      await Promise.resolve();
      // 1005 is the empty close frame: whatever `reason` was asked, a browser reports none.
      expect(seen.mock.calls[0][0], String(code)).toMatchObject({ code, reason: code === 1005 ? '' : reason, wasClean: clean });
    }
    const bad = new FakeSocket('wss://b', undefined);
    bad.open();
    expect(() => bad.serverClose(999)).toThrow('no browser reports that close code');
    expect(() => bad.serverClose(5000)).toThrow('no browser reports that close code');
    expect(() => bad.serverClose(1004)).toThrow('no browser reports that close code');
    expect(() => bad.serverClose(1015)).toThrow('no browser reports that close code');
    expect(() => bad.serverClose(2000)).toThrow('no browser reports that close code');

    const d = new FakeSocket('wss://y', undefined);
    const onerror = vi.fn();
    const dropClose = vi.fn();
    d.onerror = onerror;
    d.onclose = dropClose;
    d.open();
    d.drop();
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(dropClose).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(dropClose).toHaveBeenCalledTimes(1);
    expect(dropClose.mock.calls[0][0]).toMatchObject({ code: 1006, wasClean: false });
  });

  it("refuses a close code or reason a browser refuses, as a browser does: before anything closes, and still once the socket is closing or closed (Stage 2 Palabra, ruling 15)", async () => {
    const s = new FakeSocket('wss://x', undefined);
    s.open();
    for (const code of [1001, 1006, 1008, 2999, 5000]) {
      expect(() => s.close(code), String(code)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    }
    expect(() => s.close(1000, 'x'.repeat(124))).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    // The byte count is UTF-8, not UTF-16 code units: 24 * ('é' 2 bytes + '€' 3 bytes) + 4 ASCII = 124 bytes, but only 52 UTF-16 code units (`.length`) — short of 123 by that count (Nit 1).
    expect(() => s.close(1000, 'é€'.repeat(24) + 'aaaa')).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(s.readyState).toBe(FakeSocket.OPEN);
    expect(s.closedByClient).toBeNull();
    // What a browser takes: no code, 1000, 3000–4999, and a reason of 123 bytes.
    expect(() => new FakeSocket('wss://a', undefined).close()).not.toThrow();
    expect(() => new FakeSocket('wss://b', undefined).close(3000, 'x'.repeat(123))).not.toThrow();
    expect(() => new FakeSocket('wss://c', undefined).close(4999)).not.toThrow();

    // Still refused once the socket is closing, and once it is closed: the refusals come before the ready-state check, not after (mutant C3 moves the early return above them).
    s.close(1000);
    expect(s.readyState).toBe(FakeSocket.CLOSING);
    expect(() => s.close(1001)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(() => s.close(1000, 'x'.repeat(124))).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    await Promise.resolve();
    expect(s.readyState).toBe(FakeSocket.CLOSED);
    expect(() => s.close(1001)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(() => s.close(1000, 'x'.repeat(124))).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
  });

  it('closing a socket that never opened fails it, as a browser does: error, then an unclean 1006, after the call returns', async () => {
    const s = new FakeSocket('wss://x', undefined);
    const seen: string[] = [];
    s.onerror = () => seen.push(`error (${s.readyState})`);
    s.onclose = (ev) => seen.push(`close ${ev.code} clean=${ev.wasClean}`);
    s.close(1000, 'cancelled');
    expect(seen).toEqual([]);
    expect(s.readyState).toBe(FakeSocket.CLOSING);
    expect(s.closedByClient).toEqual({ code: 1000, reason: 'cancelled' });
    await Promise.resolve();
    expect(seen).toEqual([`error (${FakeSocket.CLOSED})`, 'close 1006 clean=false']);
  });

  it('delivers a binary frame as its binaryType asks: a Blob by default, an ArrayBuffer on request', async () => {
    const s = new FakeSocket('wss://x', undefined);
    const onmessage = vi.fn();
    s.onmessage = onmessage;
    s.open();
    s.receive(new Uint8Array([1, 2, 3]).buffer);
    const blob = onmessage.mock.calls[0][0].data as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(3);

    s.binaryType = 'arraybuffer';
    s.receive(new Uint8Array([4, 5]).buffer);
    const buffer = onmessage.mock.calls[1][0].data as ArrayBuffer;
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(buffer)]).toEqual([4, 5]);

    s.receive('text');
    expect(onmessage.mock.calls[2][0].data).toBe('text');
  });

  it('refuses to open twice, and to receive on a closed socket', async () => {
    const s = new FakeSocket('wss://x', undefined);
    s.open();
    expect(() => s.open()).toThrow();
    s.serverClose();
    await Promise.resolve();
    expect(() => s.receive('x')).toThrow();
  });
});

describe('fakeSockets', () => {
  it('the factory hands out WebSockets and keeps every one', () => {
    const f = fakeSockets();
    const ws = f.create('wss://a', ['p']);
    expect(f.last().url).toBe('wss://a');
    expect(f.last().protocols).toEqual(['p']);
    expect(ws).toBe(f.last() as unknown);

    f.create('wss://b');
    expect(f.all.map((s) => s.url)).toEqual(['wss://a', 'wss://b']);

    expect(() => fakeSockets().last()).toThrow('no socket');
  });
});
