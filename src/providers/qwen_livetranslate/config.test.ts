import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import { buildQwen, describeQwen } from './config';
import { QWEN_DEFAULTS, QWEN_MODEL, SPEAKER_CLONE, SPEAKER_CLONE_ONCE } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'intl' }],
};
const ctx = (source: string, target: string, patch: Partial<SessionContext> = {}): SessionContext => ({ direction: { source, target }, speech: true, turns: 'auto', ...patch });

describe("Qwen LiveTranslate's builder (spec §5)", () => {
  it('builds my leg: the storefront the check found, the target, my preset, automatic turns, no person labels', () => {
    expect(buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, SHARED)).toEqual({
      model: QWEN_MODEL, endpoint: 'intl', target: 'en', speech: true, voice: { kind: 'preset', name: 'Tina' }, manual: false, person: false,
      phrases: {}, silenceMs: null, transport: 'websocket',
    });
  });

  it('reads the hotwords as source=target lines for both legs: split at the first =, both sides trimmed and required, a later line winning', () => {
    const s = { ...QWEN_DEFAULTS, hotwords: ' 实时翻译 = LiveTranslate \nno separator\n=orphan\nempty=\n交流=chat\nURL=a=b\n交流=chit-chat\n' };
    const phrases = { '实时翻译': 'LiveTranslate', '交流': 'chit-chat', URL: 'a=b' };
    expect(buildQwen(ctx('zh', 'en'), s, SHARED)).toMatchObject({ phrases });
    expect(buildQwen(ctx('en', 'zh'), s, SHARED)).toMatchObject({ phrases });
  });

  it('sends a pause only under automatic turns and only when it is not the server default, kept within its range', () => {
    const at = (pauseMs: number, turns: SessionContext['turns'] = 'auto') => (buildQwen(ctx('zh', 'en', { turns }), { ...QWEN_DEFAULTS, pauseMs }, SHARED) as { silenceMs: number | null }).silenceMs;
    expect(at(2500)).toBeNull();
    expect(at(1000)).toBe(1000);
    expect(at(1000, 'manual')).toBeNull();
    expect(at(100)).toBe(500);
    expect(at(60_000)).toBe(6000);
    expect(at(Number.NaN)).toBeNull();
  });

  it("builds the other party's leg in its own voice, labelling who speaks (D7)", () => {
    expect(buildQwen(ctx('en', 'zh'), QWEN_DEFAULTS, SHARED)).toMatchObject({ target: 'zh', voice: { kind: 'preset', name: 'Ethan' }, person: true });
  });

  it('reads the storefront from the models the check found, and none from anything else', () => {
    expect(buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, { ...SHARED, models: [{ id: 'cn' }] })).toMatchObject({ endpoint: 'cn' });
    expect(buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, { ...SHARED, models: [] })).toMatchObject({ endpoint: null });
    expect(buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, { ...SHARED, models: [{ id: 'gpt-live-1' }] })).toMatchObject({ endpoint: null });
  });

  it('turns are manual under push-to-talk', () => {
    expect(buildQwen(ctx('zh', 'en', { turns: 'manual' }), QWEN_DEFAULTS, SHARED)).toMatchObject({ manual: true });
  });

  it("clones each leg's own speaker when chosen — on every turn, or once at the start — on both legs at once", () => {
    const always = { ...QWEN_DEFAULTS, voice: SPEAKER_CLONE, participantVoice: SPEAKER_CLONE };
    expect(buildQwen(ctx('zh', 'en'), always, SHARED)).toMatchObject({ voice: { kind: 'clone', frequency: 'always' } });
    expect(buildQwen(ctx('en', 'zh'), always, SHARED)).toMatchObject({ voice: { kind: 'clone', frequency: 'always' } });
    const once = { ...QWEN_DEFAULTS, voice: SPEAKER_CLONE_ONCE, participantVoice: SPEAKER_CLONE_ONCE };
    expect(buildQwen(ctx('zh', 'en'), once, SHARED)).toMatchObject({ voice: { kind: 'clone', frequency: 'once' } });
    expect(buildQwen(ctx('en', 'zh'), once, SHARED)).toMatchObject({ voice: { kind: 'clone', frequency: 'once' } });
  });

  it('runs the default for a stored voice the list does not have, and never gives the other party my preset', () => {
    expect(buildQwen(ctx('zh', 'en'), { ...QWEN_DEFAULTS, voice: 'Cherry', participantVoice: 'Ethan' }, SHARED)).toMatchObject({ voice: { kind: 'preset', name: 'Tina' } });
    expect(buildQwen(ctx('en', 'zh'), { ...QWEN_DEFAULTS, voice: 'Serena', participantVoice: 'Serena' }, SHARED)).toMatchObject({ voice: { kind: 'preset', name: 'Ethan' } });
  });

  it('refuses Auto-detect or an unknown target, and a text-only target on a leg that speaks — which builds with speech off', () => {
    expect(buildQwen(ctx('zh', AUTO), QWEN_DEFAULTS, SHARED)).toEqual({ refused: 'Qwen LiveTranslate does not translate into auto.' });
    expect(buildQwen(ctx('zh', 'zh-TW'), QWEN_DEFAULTS, SHARED)).toEqual({ refused: 'Qwen LiveTranslate does not translate into zh-TW.' });
    expect(buildQwen(ctx('zh', 'uk'), QWEN_DEFAULTS, SHARED)).toEqual({ refused: 'Qwen LiveTranslate writes uk but does not speak it: turn speech off for this leg.' });
    expect(buildQwen(ctx('zh', 'uk', { speech: false }), QWEN_DEFAULTS, SHARED)).toMatchObject({ target: 'uk', speech: false });
  });

  it('describes the one model', () => {
    const c = buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, SHARED);
    if ('refused' in c) throw new Error(c.refused);
    expect(describeQwen(c)).toEqual({ translationModel: QWEN_MODEL });
  });
});
