// src/lib/plan/wholeUnit.test.ts
import { describe, expect, it, vi } from 'vitest';
import { RUN_STAGES, TR_TL } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import { unitsOf, wholeUnit } from './wholeUnit';

const stub = (over: Record<string, unknown> = {}): AnyProvider => ({
  speech: 'optional',
  turns: vi.fn(() => ['auto', 'manual']),
  boundaries: vi.fn(() => 'silence'),
  textInput: vi.fn(() => true),
  faceToFace: true,
  participantSpeech: false,
  build: vi.fn(() => ({ built: true })),
  describe: vi.fn(() => ({ asrModel: 'a' })),
  start: vi.fn(),
  ...over,
}) as unknown as AnyProvider;

const s = {};
const p = stub();
const optional = stub();
const always = stub({ speech: 'always' });

describe('wholeUnit', () => {
  it('occupies all three stages when asked for all three', () =>
    expect(wholeUnit(p).occupies(s, new Set(RUN_STAGES))).toEqual(RUN_STAGES));

  it('occupies transcription and translation when not asked for speech, unless it always speaks', () => {
    expect(wholeUnit(optional).occupies(s, new Set(TR_TL))).toEqual(TR_TL);
    expect(wholeUnit(always).occupies(s, new Set(TR_TL))).toBeNull();
  });

  it('serves nothing else', () => {
    for (const want of [['speech'], ['transcription'], ['translation'], ['translation', 'speech'], ['transcription', 'speech'], []] as RunStage[][])
      expect(wholeUnit(optional).occupies(s, new Set(want))).toBeNull();
  });

  it("answers the definition's own capabilities", () =>
    expect(wholeUnit(p).capabilities(s)).toEqual({
      speech: p.speech, turns: p.turns(s), turnOwner: 'either', boundaries: p.boundaries(s),
      textInput: p.textInput(s), faceToFace: p.faceToFace === true, participantSpeech: p.participantSpeech !== false,
    }));

  it('reads faceToFace and participantSpeech with their defaults', () => {
    const caps = wholeUnit(stub({ faceToFace: undefined, participantSpeech: undefined })).capabilities(s);
    expect(caps.faceToFace).toBe(false);
    expect(caps.participantSpeech).toBe(true);
  });

  it("builds, describes and starts with the definition's own functions", () => {
    const u = wholeUnit(p);
    expect(u.start).toBe(p.start);
    expect(u.describe).toBe(p.describe);
    const context = { c: 1 } as never;
    const shared = { sh: 1 } as never;
    expect(u.build(context, s, shared)).toEqual({ built: true });
    expect(p.build).toHaveBeenCalledWith(context, s, shared);
  });

  it('is the same object for the same provider', () => expect(unitsOf(p)).toBe(unitsOf(p)));

  it("uses a provider's own list when it declares one", () => {
    const own = [wholeUnit(p)];
    expect(unitsOf(stub({ units: own }))).toBe(own);
  });
});
