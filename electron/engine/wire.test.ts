// @vitest-environment node
/**
 * The outbound wire contract (ported from sidecar/tests/test_wire.py): the schema's shape and checkOutbound's
 * behaviour. SOKUJI_WIRE_STRICT=1 makes a violation throw; without it a violation is reported to stderr once per
 * type and the message is still sent — a contract bug must never take down a live session.
 */
import './test/env';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA, WireContractError, checkOutbound, resetWireWarningsForTests } from './wire';

const strict = (on: boolean) => {
  if (on) process.env.SOKUJI_WIRE_STRICT = '1';
  else delete process.env.SOKUJI_WIRE_STRICT;
};

describe('the wire contract', () => {
  let stderr: string[];
  beforeEach(() => {
    stderr = [];
    resetWireWarningsForTests();
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    strict(true);
  });

  it('covers every type, with sane shapes', () => {
    // 19 ServerMsg members + pong.
    expect(Object.keys(SCHEMA)).toHaveLength(20);
    expect(SCHEMA.pong).toBeDefined();
    for (const [type, spec] of Object.entries(SCHEMA)) {
      expect(Object.keys(spec).sort(), type).toEqual(['optional', 'required']);
      expect(spec.required.has('type') || spec.optional.has('type'), type).toBe(false);
      expect([...spec.required].filter((f) => spec.optional.has(f)), type).toEqual([]);
    }
  });

  it('lets valid messages through in strict mode', () => {
    strict(true);
    checkOutbound({ type: 'ok', id: 3 });
    checkOutbound({ type: 'ready', id: 1, loadTimeMs: 5, backend: 'moss_onnx', rtf: 0.2 });
    checkOutbound({ type: 'ready', id: 2, loadTimeMs: 5, backend: 'native_tts', family: 'moss_tts_nano' });
    checkOutbound({ type: 'error', message: 'boom' });
    checkOutbound({ type: 'partial', text: 'hi' });
    checkOutbound({ type: 'result', text: 'hi', durationMs: 10, recognitionTimeMs: 2 });
    checkOutbound({ type: 'translate_partial', text: 'hi' });
  });

  it.each([
    [{ type: 'no_such_message', id: 1 }, /unknown outbound type/],
    [{ type: 'ok' }, /missing required/],
    [{ type: 'ok', id: 1, extra: true }, /unexpected field/],
    [{ id: 1 }, /has no 'type'/],
  ])('throws on a violation in strict mode: %j', (bad, match) => {
    strict(true);
    expect(() => checkOutbound(bad)).toThrow(WireContractError);
    expect(() => checkOutbound(bad)).toThrow(match);
  });

  it('fails open outside strict mode: reported, not thrown', () => {
    strict(false);
    checkOutbound({ type: 'ok' });
    const err = stderr.join('');
    expect(err).toContain('[wire]');
    expect(err).toContain('missing required');
  });

  it('reports a violation once per type outside strict mode', () => {
    strict(false);
    checkOutbound({ type: 'ok' });
    checkOutbound({ type: 'ok' });
    checkOutbound({ type: 'ready' });
    expect(stderr.filter((l) => l.includes('[wire]'))).toHaveLength(2);
  });

  it('the suite runs in strict mode (vitest setup for engine tests)', () => {
    expect(process.env.SOKUJI_WIRE_STRICT).toBe('1');
  });

  it('the schema file is the loaded source', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'wire_schema.json'), 'utf8')) as Record<string, unknown>;
    delete raw._comment;
    expect(Object.keys(raw).sort()).toEqual(Object.keys(SCHEMA).sort());
  });

  it('a validator crash fails open outside strict mode', () => {
    strict(false);
    checkOutbound(['not', 'a', 'dict'] as never);
    const err = stderr.join('');
    expect(err).toContain('[wire]');
    expect(err).toContain('validator crashed');
  });

  it('a validator crash is loud in strict mode: the raw bug, not a contract error', () => {
    strict(true);
    expect(() => checkOutbound(['not', 'a', 'dict'] as never)).toThrow(TypeError);
  });
});
