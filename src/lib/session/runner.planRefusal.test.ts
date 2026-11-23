import { describe, expect, it, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { refusalNotice } from '../plan/checks';
import { PLAN_REFUSAL_CODES } from '../plan/types';
import { RUN_NOTICE_CODES } from './codes';
import type { RunnerDeps } from './ports';
import { createRunner } from './runner';
import type { RunNotice } from '../run/types';

/** A runner whose start finds no shape: only what such a start reaches is real. */
function runnerWithNoShape(planRefusal?: () => RunNotice | null) {
  const track = vi.fn();
  const runner = createRunner({
    clock: createVirtualClock(0),
    platform: 'electron',
    readShape: () => null,
    ...(planRefusal ? { planRefusal } : {}),
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => { throw new Error('never opened'); },
    playback: { audio: () => [], held: () => {}, clear: () => {}, live: () => {} },
    analytics: { track },
    newSessionId: () => 'run',
  } satisfies RunnerDeps);
  return { runner, track };
}

describe('a start that finds no shape', () => {
  it("answers the line-up's refusal when the line-up is why", async () => {
    const notice = refusalNotice({ refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'kizunaai_qwen' });
    const { runner } = runnerWithNoShape(() => notice);
    await runner.start();
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'refused', notice } });
  });

  it.each([['no port', undefined], ['a port that names no refusal', () => null]] as const)('answers that no provider is chosen with %s', async (_name, port) => {
    const { runner } = runnerWithNoShape(port);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no_provider' } } });
  });

  it("every refusal of a line-up is a code the runner's notices list", () => {
    for (const code of PLAN_REFUSAL_CODES) expect(RUN_NOTICE_CODES).toContain(code);
  });
});
