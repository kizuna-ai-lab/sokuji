// @vitest-environment node
/** While the Python sidecar is in the tree, the engine's wire schema is a copy of its own. */
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

it('the engine schema equals the sidecar schema', () => {
  expect(read('electron/engine/wire_schema.json')).toBe(read('sidecar/sokuji_sidecar/wire_schema.json'));
});
