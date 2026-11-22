import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEV_ONLY, RELEASED } from '../../providers/registry';
import { stubProvider } from '../plan/testing';
import { E2E_CAPS, RELEASED_CAPS } from './catalog.testing';
import { capsOf, catalogOf, occupationsOf } from './capsOf';
import type { ProviderCaps, RunStage } from './types';

const byId = (list: readonly ProviderCaps[]) => Object.fromEntries(list.map((c) => [c.id, c]));
const unit = (id: string, stages: RunStage[]) => ({ id, occupies: (_s: unknown, want: ReadonlySet<RunStage>) => (want.size === stages.length && stages.every((s) => want.has(s)) ? stages : null) });
const provider = (o: Record<string, unknown>) => stubProvider('p', { kind: 'own-key', settings: { defaults: {} }, ...o });
const TR = ['transcription'] as RunStage[], TL = ['translation'] as RunStage[], SP = ['speech'] as RunStage[], TR_TL = [...TR, ...TL], ALL = [...TR_TL, ...SP];

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('capsOf', () => {
  it('is the catalog declared by hand, entry for entry, for the released providers', () => {
    expect(catalogOf(RELEASED).map((c) => c.id)).toEqual(RELEASED.map((p) => p.id));
    expect(byId(catalogOf(RELEASED))).toStrictEqual(byId(RELEASED_CAPS));
  });
  it("and for the E2E build's fakes, in the registry's order", () => {
    expect(catalogOf(DEV_ONLY).map((c) => c.id)).toEqual(DEV_ONLY.map((p) => p.id));
    expect(byId(catalogOf(DEV_ONLY))).toStrictEqual(byId(E2E_CAPS));
  });
  it("a provider's occupations are the same with no settings as with its default settings", () => {
    for (const p of [...RELEASED, ...DEV_ONLY]) expect(occupationsOf(p, undefined), p.id).toEqual(occupationsOf(p, p.settings.defaults));
  });
  // Removed in Task 3, with the list it compares against.
  it('the golden list is the catalog declared by hand; the fakes differ only in their account, which follows their kind', async () => {
    expect(byId(RELEASED_CAPS)).toStrictEqual(byId((await import('./catalog')).allCaps()));
    vi.stubEnv('MODE', 'e2e'); vi.resetModules();
    const declared = (await import('./catalog')).allCaps().filter((c) => !RELEASED_CAPS.some((r) => r.id === c.id));
    expect(byId(declared)).toStrictEqual(byId(E2E_CAPS.map((c) => ({ ...c, account: 'none' as const }))));
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
