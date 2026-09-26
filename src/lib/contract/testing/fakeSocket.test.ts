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

  it('a server close is clean only at 1000; a drop is an error, then an unclean 1006', async () => {
    const s = new FakeSocket('wss://x', undefined);
    const onclose = vi.fn();
    s.onclose = onclose;
    s.open();
    s.serverClose(1011, 'err');
    await Promise.resolve();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onclose.mock.calls[0][0]).toMatchObject({ code: 1011, reason: 'err', wasClean: false });

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
