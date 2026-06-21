import { describe, it, expect } from 'vitest';
import { parseHandshake, resolvePython } from './native-host-manager.js';

describe('parseHandshake', () => {
  it('extracts the bound port from the handshake JSON line', () => {
    expect(parseHandshake('{"port": 51791}')).toBe(51791);
  });
  it('returns null for non-handshake lines', () => {
    expect(parseHandshake('loading model…')).toBeNull();
    expect(parseHandshake('{"type":"ready"}')).toBeNull();
  });
});

describe('resolvePython', () => {
  it('honors SOKUJI_SIDECAR_PYTHON when set', () => {
    const prev = process.env.SOKUJI_SIDECAR_PYTHON;
    process.env.SOKUJI_SIDECAR_PYTHON = '/custom/python';
    expect(resolvePython()).toBe('/custom/python');
    process.env.SOKUJI_SIDECAR_PYTHON = prev;
  });
});
