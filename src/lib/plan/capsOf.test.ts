import { describe, expect, it } from 'vitest';
import { DEV_ONLY, RELEASED } from '../../providers/registry';
import { stubProvider } from './testing';
import { E2E_CAPS, RELEASED_CAPS } from '../lineup/catalog.testing';
import { capsOf, catalogOf, occupationsOf } from './capsOf';
import type { ProviderCaps, RunStage } from '../lineup/types';

const byId = (list: readonly ProviderCaps[]) => Object.fromEntries(list.map((c) => [c.id, c]));
const unit = (id: string, stages: RunStage[]) => ({ id, occupies: (_s: unknown, want: ReadonlySet<RunStage>) => (want.size === stages.length && stages.every((s) => want.has(s)) ? stages : null) });
const provider = (o: Record<string, unknown>) => stubProvider('p', { kind: 'own-key', settings: { defaults: {} }, ...o });
const TR = ['transcription'] as RunStage[], TL = ['translation'] as RunStage[], SP = ['speech'] as RunStage[], TR_TL = [...TR, ...TL], ALL = [...TR_TL, ...SP];

describe('capsOf', () => {
  it('is the catalog declared by hand, entry for entry, for the released providers', () => {
    expect(catalogOf(RELEASED).map((c) => c.id)).toEqual(RELEASED.map((p) => p.id));
    expect(RELEASED_CAPS.map((c) => c.id)).toEqual(RELEASED.map((p) => p.id));
    expect(byId(catalogOf(RELEASED))).toStrictEqual(byId(RELEASED_CAPS));
  });
  it("and for the E2E build's fakes, in the registry's order", () => {
    expect(catalogOf(DEV_ONLY).map((c) => c.id)).toEqual(DEV_ONLY.map((p) => p.id));
    expect(byId(catalogOf(DEV_ONLY))).toStrictEqual(byId(E2E_CAPS));
  });
  it("a provider's occupations are the same with no settings as with its default settings", () => {
    for (const p of [...RELEASED, ...DEV_ONLY]) expect(occupationsOf(p, undefined), p.id).toEqual(occupationsOf(p, p.settings.defaults));
  });
  it('occupies never reads the settings: the catalog is derived from it once, without any', () => {
    const trap = new Proxy({}, { get: (_t, k) => { throw new Error(`occupies read settings.${String(k)}`); }, has: () => { throw new Error('occupies probed settings'); } });
    for (const p of [...RELEASED, ...DEV_ONLY]) {
      expect(() => occupationsOf(p, trap), p.id).not.toThrow();
      expect(occupationsOf(p, trap), p.id).toEqual(occupationsOf(p, p.settings.defaults));
    }
  });
  it('every provider declares its units', () => {
    expect([...RELEASED, ...DEV_ONLY].filter((p) => !Array.isArray(p.units) || p.units.length === 0).map((p) => p.id)).toEqual([]);
  });
  it('a provider whose only unit is a whole unit is end to end, except the fakes listed here', () => {
    // `fake`: the E2E build's stand-in, a plain transcribe/translate/speak provider that is not a vendor's end-to-end service.
    const NOT_END_TO_END = new Set(['fake']);
    const forgotten = [...RELEASED, ...DEV_ONLY].filter((p) => p.units.length === 1 && p.units[0].id === 'whole' && !NOT_END_TO_END.has(p.id) && p.endToEnd !== true).map((p) => p.id);
    expect(forgotten).toEqual([]);
  });
  it('stages: what its units occupy, together', () => { expect(capsOf(provider({ units: [unit('a', TR), unit('b', SP)] })).stages).toEqual(['transcription', 'speech']); });
  it('voiceAlone: a unit occupies speech alone', () => {
    expect(capsOf(provider({ units: [unit('a', SP)] })).voiceAlone).toBe(true);
    expect(capsOf(provider({ units: [unit('a', ALL)] })).voiceAlone).toBe(false);
  });
  it("translatesOwn: Soniox's shape, and nothing else", () => {
    expect(capsOf(provider({ units: [unit('stt', TR_TL), unit('tr', TR), unit('tts', SP)] })).translatesOwn).toBe(true);
    for (const units of [[unit('tr', TR)], [unit('tr', TR), unit('tl', TL)], [unit('w', TR_TL)]]) expect('translatesOwn' in capsOf(provider({ units }))).toBe(false);
  });
  it('joint: the stages its units never serve apart', () => {
    expect(capsOf(provider({ units: [unit('w', ALL), unit('t', TR_TL)] })).joint).toEqual(TR_TL);
    expect(capsOf(provider({ units: [unit('w', ALL)] })).joint).toEqual(ALL);
    expect('joint' in capsOf(provider({ units: [unit('a', TR), unit('b', TL), unit('c', SP)] }))).toBe(false);
  });
  it('takesVoice: a unit serves its text without its voice', () => {
    expect(capsOf(provider({ units: [unit('a', SP)] })).takesVoice).toBe(false);
    expect(capsOf(provider({ units: [unit('a', TL)] })).takesVoice).toBe(true);
  });
  it('an end-to-end provider: every stage joint, its text read by no other voice, whatever its units say', () => {
    expect(capsOf(provider({ endToEnd: true, units: [unit('w', ALL), unit('t', TR_TL)] }))).toMatchObject({ stages: ALL, joint: ALL, voiceAlone: false, takesVoice: false });
  });
  it('account and host: from its kind, and its own id', () => {
    expect(['managed', 'own-key', 'local', 'online'].map((kind) => capsOf(provider({ kind, units: [unit('a', TL)] })).account)).toEqual(['kizuna', 'key', 'none', 'none']);
    expect(capsOf(provider({ units: [unit('a', TL)] })).host).toBe('p');
  });
});
