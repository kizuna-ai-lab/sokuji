// electron/exitHandler.wiring.test.js
//
// main.js cannot be booted in vitest; how it wires exit-handler.js is asserted
// on its source text, like closeHandshake.wiring.test.js does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(__dirname, 'main.js'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
function at(text, needle) {
  const i = text.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
}

describe('exit handler wiring', () => {
  it('drops failed stdio writes before main.js logs anything', () => {
    expect(at(main, 'ignoreStdioErrors()')).toBeLessThan(at(main, 'console.'));
  });

  it('sends every signal and crash through the one-shot handler', () => {
    expect(main).toMatch(/const handleExit = createExitHandler\(\{ cleanup: cleanupAndExit \}\);/);
    for (const event of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
      expect(main).toContain(`handleExit('${event}')`);
    }
    // The hand-written handler it replaces ran again for every exception.
    expect(main).not.toMatch(/const handleExit = \(signal\) =>/);
  });
});
