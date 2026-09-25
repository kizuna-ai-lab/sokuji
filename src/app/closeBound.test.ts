import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOSE_TIMEOUT_MS } from '../lib/session/runner';

const { DEFAULT_TIMEOUT_MS } = createRequire(import.meta.url)('../../electron/close-handshake.js');

describe("Electron's close wait", () => {
  it("outlasts the runner's own ending bound by one second (1e-3 ruling 12)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(DEFAULT_CLOSE_TIMEOUT_MS + 1_000);
  });
});
