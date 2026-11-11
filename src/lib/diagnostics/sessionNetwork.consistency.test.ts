/**
 * One allowlist, three users: the collector in the main process, the leases
 * that name a stage in their `session.network` frames, and the renderer bridge
 * that turns a stage back into a path. Each must be able to work without
 * trusting the others' strings, so the table exists in more than one place —
 * this test is what keeps the copies from drifting. A stage added on one side
 * and forgotten on another would otherwise show up as a request that is
 * recorded but never displayed, or displayed under another endpoint's name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { NETWORK_STAGE_PATHS } from './sessionNetwork';

const REPO_ROOT = resolve(__dirname, '../../..');
const requireCjs = createRequire(import.meta.url);

describe('session network diagnostics: the stage allowlist', () => {
  it('the collector watches exactly the stages the leases frame, under the same paths', () => {
    const { STAGE_PATHS } = requireCjs(resolve(REPO_ROOT, 'electron/session-network-diagnostics.js'));
    expect(Object.fromEntries(STAGE_PATHS)).toEqual(NETWORK_STAGE_PATHS);
  });

  it('every stage a lease frames is allowlisted, and every allowlisted stage is framed', () => {
    const framed = ['src/providers/soniox/lease.ts', 'src/providers/qwen_livetranslate/lease.ts']
      .flatMap((file) => [...readFileSync(resolve(REPO_ROOT, file), 'utf8').matchAll(/recordNetworkAttempt\(ctx, '([^']+)'\)/g)])
      .map((match) => match[1]);
    // Guard the scan itself: a rename that leaves it matching nothing must fail here.
    expect(framed.length).toBeGreaterThan(0);
    expect([...new Set(framed)].sort()).toEqual(Object.keys(NETWORK_STAGE_PATHS).sort());
  });

  it('names only the managed endpoints, never a provider-direct or unrelated backend path', () => {
    for (const path of Object.values(NETWORK_STAGE_PATHS)) {
      expect(path).toMatch(/^\/api\/(soniox|qwen)\//);
    }
  });
});
