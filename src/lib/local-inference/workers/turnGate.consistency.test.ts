import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SMART_TURN_WORKER_TYPES } from '../../turn/smartTurn';

const WORKERS_DIR = __dirname;

const EXEMPT: Record<string, string> = {
  'native-vad.worker.ts': "Local Native's VAD, which follows that provider onto the new contract (#578)",
  'voxtral-webgpu.worker.ts': 'it streams, and already ends a segment on sentence punctuation',
};

const vadWorkers = readdirSync(WORKERS_DIR)
  .filter((name) => name.endsWith('.worker.ts'))
  .map((name) => ({ name, source: readFileSync(join(WORKERS_DIR, name), 'utf8') }))
  .filter(({ source }) => source.includes('new FrameProcessor('));

function between(source: string, from: string, to: string): string {
  const a = source.indexOf(from);
  expect(a, `anchor ${JSON.stringify(from)}`).toBeGreaterThanOrEqual(0);
  const b = source.indexOf(to, a + from.length);
  expect(b, `anchor ${JSON.stringify(to)}`).toBeGreaterThanOrEqual(0);
  return source.slice(a, b);
}

describe('Smart Turn gate wiring', () => {
  it('finds the vad-web workers', () => {
    expect(vadWorkers.map((w) => w.name).sort()).toEqual(
      [...SMART_TURN_WORKER_TYPES.map((type) => `${type}.worker.ts`), ...Object.keys(EXEMPT)].sort(),
    );
  });

  for (const { name, source } of vadWorkers) {
    if (name in EXEMPT) {
      it(`${name} stays out: ${EXEMPT[name]}`, () => {
        expect(source).not.toMatch(/_shared\/turn-gate/);
      });
      continue;
    }

    describe(name, () => {
      it('opens the link from its init message', () => {
        expect(source).toMatch(/from '\.\/_shared\/turn-gate'/);
        expect(source).toMatch(/turnLink = openTurnLink\(msg\.turnPort, msg\.vadConfig, frameProcessor\);/);
      });

      it("feeds the gate every frame's speech probability", () => {
        expect(source).toMatch(/case Message\.FrameProcessed:\s*speechProbability = ev\.probs\.isSpeech;/);
        expect(source).toMatch(/turnLink\?\.afterFrame\(frame, speechProbability, frameProcessor\.speaking\)/);
      });

      it('resets the gate where the worker ends a segment itself', () => {
        expect(between(source, 'speechFramesSinceStart >= maxSpeechFrames', 'speechFramesSinceStart = 0;')).toMatch(/turnLink\?\.reset\(\)/);
        expect(between(source, 'async function handleFlush', 'async function handleDispose')).toMatch(/turnLink\?\.reset\(\)/);
      });

      it('decodes a misfire the gate hands back, on a frame and in a flush, without awaiting it', () => {
        const rescue = /const rescued = turnLink\?\.rescue\(\);\s*if \(rescued\) void \w+\(rescued/;
        expect(between(source, 'case Message.VADMisfire', 'break;')).toMatch(rescue);
        const flush = between(source, 'async function handleFlush', 'turnLink?.reset()');
        expect(flush).toMatch(/Message\.VADMisfire/);
        expect(flush).toMatch(rescue);
      });

      it('tells each decode how its segment ended, and posts that with the result', () => {
        const ended = (by: string) => new RegExp(`endedBy: '${by}'`);
        expect(between(source, 'case Message.SpeechEnd', 'break;')).toMatch(ended('silence'));
        expect(between(source, 'case Message.VADMisfire', 'break;')).toMatch(ended('kept'));
        const smart = between(source, 'turnLink?.afterFrame(', '// Max speech duration cap');
        expect(smart).toMatch(ended('smart'));
        expect(smart).toMatch(/smartTurnProbability/);
        expect(between(source, 'speechFramesSinceStart >= maxSpeechFrames', 'speechFramesSinceStart = 0;')).toMatch(ended('cap'));
        const flush = between(source, 'async function handleFlush', 'turnLink?.reset()');
        expect(flush).toMatch(ended('flush'));
        expect(flush).toMatch(ended('kept'));
        expect(between(source, "type: 'result'", '}')).toMatch(/\.\.\.end\b/);
      });

      it('closes the link on dispose', () => {
        expect(source.slice(source.indexOf('async function handleDispose'))).toMatch(/turnLink\?\.close\(\)/);
      });
    });
  }
});
