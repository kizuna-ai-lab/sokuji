// src/lib/plan/wholeUnit.test.ts
import { describe, expect, it, vi } from 'vitest';
import { RUN_STAGES, TR_TL } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { UnitCapabilities } from '../run/types';
import { capabilitiesAlone, unitsOf, wholePlan, wholeUnitOf } from './wholeUnit';
import type { WholeUnitParts } from './wholeUnit';

const parts = (over: Record<string, unknown> = {}): WholeUnitParts => ({
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
}) as unknown as WholeUnitParts;

const provider = (units: unknown): AnyProvider => ({ id: 'p', settings: { key: 'p', defaults: s }, units }) as unknown as AnyProvider;

const s = {};
const occupying = (id: string, ...stages: RunStage[]) => ({ id, occupies: vi.fn((_s: unknown, want: ReadonlySet<RunStage>) => (want.size === stages.length && stages.every((st) => want.has(st)) ? stages : null)) });
const p = parts();
const optional = parts();
const always = parts({ speech: 'always' });

describe('wholeUnitOf', () => {
  it('occupies all three stages when asked for all three', () =>
    expect(wholeUnitOf(p).occupies(s, new Set(RUN_STAGES))).toEqual(RUN_STAGES));

  it('occupies transcription and translation when not asked for speech, unless it always speaks', () => {
    expect(wholeUnitOf(optional).occupies(s, new Set(TR_TL))).toEqual(TR_TL);
    expect(wholeUnitOf(always).occupies(s, new Set(TR_TL))).toBeNull();
  });

  it('serves nothing else', () => {
    for (const want of [['speech'], ['transcription'], ['translation'], ['translation', 'speech'], ['transcription', 'speech'], []] as RunStage[][])
      expect(wholeUnitOf(optional).occupies(s, new Set(want))).toBeNull();
  });

  it("answers its parts' capabilities", () =>
    expect(wholeUnitOf(p).capabilities(s)).toEqual({
      speech: p.speech, turns: p.turns(s), turnOwner: 'either', boundaries: p.boundaries(s),
      textInput: p.textInput(s), faceToFace: p.faceToFace === true, participantSpeech: p.participantSpeech !== false,
    }));

  it('reads faceToFace and participantSpeech with their defaults', () => {
    const caps = wholeUnitOf(parts({ faceToFace: undefined, participantSpeech: undefined })).capabilities(s);
    expect(caps.faceToFace).toBe(false);
    expect(caps.participantSpeech).toBe(true);
  });

  it("builds, describes and starts with its parts' functions", () => {
    const u = wholeUnitOf(p);
    expect(u.start).toBe(p.start);
    expect(u.describe).toBe(p.describe);
    const context = { c: 1 } as never;
    const shared = { sh: 1 } as never;
    expect(u.build(context, s, shared)).toEqual({ built: true });
    expect(p.build).toHaveBeenCalledWith(context, s, shared);
  });

  it('asks its parts when used: a capability read calls only its own function, and start and describe are the ones its parts hold then', () => {
    const q = parts();
    const caps = wholeUnitOf(q).capabilities(s);
    expect(caps.textInput).toBe(true);
    expect(q.textInput).toHaveBeenCalledTimes(1);
    expect(q.turns).not.toHaveBeenCalled();
    expect(q.boundaries).not.toHaveBeenCalled();
    const u = wholeUnitOf(q);
    const start = vi.fn();
    const describe = vi.fn();
    Object.assign(q, { start, describe });
    expect(u.start).toBe(start);
    expect(u.describe).toBe(describe);
  });

  it('is the same object for the same provider', () => {
    const q = provider([wholeUnitOf(parts())]);
    expect(unitsOf(q)).toBe(unitsOf(q));
  });

  it("plans a provider alone: its first unit on all three stages", () => {
    const q = provider([wholeUnitOf(parts())]);
    const plan = wholePlan(q);
    expect(plan.units).toEqual([{ provider: q, unit: unitsOf(q)[0], stages: RUN_STAGES }]);
    expect(RUN_STAGES.map((stage) => plan.byStage[stage])).toEqual([plan.units[0], plan.units[0], plan.units[0]]);
  });

  describe('the plan of a provider alone, by the units it declares', () => {
    const all = () => occupying('all', ...RUN_STAGES);
    const text = () => occupying('text', ...TR_TL);
    const voice = () => occupying('voice', 'speech');
    const tr = () => occupying('tr', 'transcription');
    const stagesOf = (units: unknown[]) => {
      const plan = wholePlan(provider(units));
      return { units: plan.units.map((u) => [u.unit.id, u.stages]), byStage: RUN_STAGES.map((stage) => plan.byStage[stage].unit.id) };
    };

    it.each([
      ['one unit for all three', [all()], [['all', RUN_STAGES]], ['all', 'all', 'all']],
      ['a unit for all three among others: it alone', [text(), voice(), all()], [['all', RUN_STAGES]], ['all', 'all', 'all']],
      ['a text unit and a voice: the two, in stage order', [voice(), text()], [['text', TR_TL], ['voice', ['speech']]], ['text', 'text', 'voice']],
      ['the whole of a provider beside its voice: the whole unit alone, as a provider with one unit', [wholeUnitOf(optional), voice()], [['whole', RUN_STAGES]], ['whole', 'whole', 'whole']],
      ['a voice alone: its first unit on all three, as before', [voice()], [['voice', RUN_STAGES]], ['voice', 'voice', 'voice']],
      ['a text unit alone: its first unit on all three', [text()], [['text', RUN_STAGES]], ['text', 'text', 'text']],
      ['units that do not make up the three stages: the first on all three', [tr(), voice()], [['tr', RUN_STAGES]], ['tr', 'tr', 'tr']],
    ] as const)('%s', (_name, units, planned, byStage) => {
      expect(stagesOf([...units])).toEqual({ units: planned, byStage });
    });

    it('asks each unit for exactly the stages, under no settings', () => {
      const t = text();
      wholePlan(provider([t, voice()]));
      expect(t.occupies.mock.calls.map(([s, want]) => [s, [...want]])).toEqual([[undefined, RUN_STAGES], [undefined, TR_TL], [undefined, ['speech']]]);
    });

    it('holds each unit once: the stages of a unit are one planned unit', () => {
      const plan = wholePlan(provider([text(), voice()]));
      expect(plan.byStage.transcription).toBe(plan.byStage.translation);
      expect(plan.units).toEqual([plan.byStage.transcription, plan.byStage.speech]);
    });
  });

  it("uses a provider's own list when it declares one", () => {
    const own = [wholeUnitOf(p)];
    expect(unitsOf(provider(own))).toBe(own);
  });
});

it('reads none of its parts when made: each is read when the unit is used', () => {
  const trap = new Proxy({}, { get: (_t, k) => { throw new Error(`read ${String(k)}`); } }) as WholeUnitParts;
  expect(() => wholeUnitOf(trap)).not.toThrow();
});

describe('capabilitiesAlone', () => {
  const caps = (o: Partial<UnitCapabilities>): UnitCapabilities => ({ speech: 'never', turns: ['auto'], turnOwner: 'either', boundaries: 'provider', textInput: false, faceToFace: false, participantSpeech: true, ...o });
  it('is what the unit serving the stage can do in a run on the provider alone, under its default settings', () => {
    const text = { ...occupying('text', ...TR_TL), capabilities: vi.fn(() => caps({ faceToFace: true })) };
    const voice = { ...occupying('voice', 'speech'), capabilities: vi.fn(() => caps({ speech: 'optional', participantSpeech: false })) };
    const p = { id: 'p', settings: { key: 'p', defaults: { d: 1 } }, units: [voice, text] } as unknown as AnyProvider;
    expect(capabilitiesAlone(p, 'speech')).toMatchObject({ speech: 'optional', participantSpeech: false });
    expect(capabilitiesAlone(p, 'transcription').faceToFace).toBe(true);
    expect(voice.capabilities).toHaveBeenCalledWith({ d: 1 });
  });
  it('a provider that only speaks answers with its one unit, for every stage', () => {
    const voice = { ...occupying('voice', 'speech'), capabilities: () => caps({ speech: 'optional', faceToFace: true }) };
    const p = { id: 'p', settings: { key: 'p', defaults: {} }, units: [voice] } as unknown as AnyProvider;
    expect(capabilitiesAlone(p, 'transcription')).toMatchObject({ speech: 'optional', faceToFace: true });
  });
});
