import { describe, expect, it, vi } from 'vitest';
import { OVERLAY_ENTRIES } from '../../lib/subtitle/wire';
import { tallied, type WireTally } from './wireTally';

const bytes = (m: unknown) => new TextEncoder().encode(JSON.stringify(m)).length;

const stubWire = () => ({
  post: vi.fn(),
  onMessage: vi.fn(),
  onDisconnect: vi.fn(),
  close: vi.fn(),
});

describe('tallied', () => {
  it('counts each message type in the JSON bytes the extension would carry, and passes every message on', () => {
    const wire = stubWire();
    const tally: WireTally = {};
    const counted = tallied(wire, tally);
    const a = { type: 'subtitle:language', language: 'ja' };
    const b = { type: 'subtitle:entries', entries: [{ text: 'é' }] };
    counted.post(a);
    counted.post(b);
    counted.post(a);
    expect(wire.post.mock.calls[0][0]).toBe(a);
    expect(wire.post.mock.calls[1][0]).toBe(b);
    expect(wire.post.mock.calls[2][0]).toBe(a);
    expect(tally['subtitle:language']).toEqual({ count: 2, bytes: 2 * bytes(a), max: bytes(a) });
    expect(tally['subtitle:entries']).toEqual({ count: 1, bytes: bytes(b), max: bytes(b) });
    expect(bytes(b)).toBe(JSON.stringify(b).length + 1);
  });

  it("counts a message with no `type` under '?'", () => {
    const wire = stubWire();
    const tally: WireTally = {};
    const counted = tallied(wire, tally);
    counted.post({ x: 1 });
    expect(tally['?'].count).toBe(1);
  });

  it('passes the rest of the wire through untouched', () => {
    const wire = stubWire();
    const tally: WireTally = {};
    const counted = tallied(wire, tally);
    expect(counted.onMessage).toBe(wire.onMessage);
    expect(counted.onDisconnect).toBe(wire.onDisconnect);
    expect(counted.close).toBe(wire.close);
  });

  it('keeps the steady maximum apart: entries messages that carried the full tail', () => {
    const wire = stubWire();
    const tally: WireTally = {};
    const counted = tallied(wire, tally);
    const full = (n: number) => ({ type: 'subtitle:entries', entries: Array.from({ length: n }, (_, i) => ({ id: 'e' + i })) });

    counted.post(full(OVERLAY_ENTRIES - 1));
    expect(tally['subtitle:entries'].steadyMax).toBeUndefined();

    const padded = { ...full(OVERLAY_ENTRIES - 1), pad: 'x'.repeat(5_000) };
    counted.post(padded);
    counted.post(full(OVERLAY_ENTRIES));
    counted.post(full(OVERLAY_ENTRIES + 3));

    expect(tally['subtitle:entries'].steadyMax).toBe(bytes(full(OVERLAY_ENTRIES + 3)));
    expect(tally['subtitle:entries'].max).toBe(bytes(padded));
    expect(tally['subtitle:entries'].max).toBeGreaterThan(tally['subtitle:entries'].steadyMax!);

    counted.post({ type: 'subtitle:session', entries: full(40).entries });
    expect(tally['subtitle:session'].steadyMax).toBeUndefined();
  });
});
