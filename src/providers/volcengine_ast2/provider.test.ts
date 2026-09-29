import { afterEach, describe, it, expect, vi } from 'vitest';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { VolcengineIcon } from '../../components/Icons/ProviderIcons';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { readCredentials } from '../../lib/provider/credentials';
import { contextsFor } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { PROVIDERS } from '../registry';
import { Ast2SettingsView } from './Ast2Settings';
import { buildAst2, describeAst2, type Ast2Config } from './config';
import { volcengineAst2Provider } from './provider';
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, migrateAst2Settings, type Ast2Settings } from './settings';
import { APP_KEY, AUTO_CTX, configFor, SHARED } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

describe('the Doubao AST 2.0 definition', () => {
  it('is Doubao AST 2.0 with your own credentials, on every platform (ruling 2), under its old id and slice', () => {
    expect(volcengineAst2Provider).toMatchObject({
      id: 'volcengine_ast2',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: VolcengineIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/volcengine-ast2-setup',
      settings: { key: 'volcengineAST2', defaults: AST2_DEFAULTS, migrate: migrateAst2Settings },
      Settings: Ast2SettingsView,
      credentials: ast2Credentials,
      languages: ast2Languages,
      build: buildAst2,
      describe: describeAst2,
    });
    for (const absent of ['flagged', 'i18nKey', 'TurnDetection', 'session', 'participantSpeech'] as const) {
      expect(volcengineAst2Provider, absent).not.toHaveProperty(absent);
    }
  });

  it('speaks optionally, takes no typed text, lets the server end segments, and offers both turn modes', () => {
    expect(volcengineAst2Provider.speech).toBe('optional');
    expect(volcengineAst2Provider.textInput(AST2_DEFAULTS)).toBe(false);
    expect(volcengineAst2Provider.boundaries(AST2_DEFAULTS)).toBe('provider');
    expect(volcengineAst2Provider.turns(AST2_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits after Gemini (ruling 5)', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('volcengine_ast2')).toBe(ids.indexOf('gemini') + 1);
  });

  it('lets the participant speak when its switch is on, speech to speech on the reversed pair (ruling 4)', () => {
    const shape = { provider: volcengineAst2Provider, pair: { source: 'zh', target: 'en' }, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true, turnMode: 'auto' } as unknown as RunShape;
    const participant = contextsFor(shape).participant!;
    expect(participant).toEqual({ direction: { source: 'en', target: 'zh' }, speech: true, turns: 'auto' });
    expect((volcengineAst2Provider.build(participant, AST2_DEFAULTS, SHARED) as Ast2Config).mode).toBe('s2s');
    expect(contextsFor({ ...shape, participantSpeech: false }).participant!.speech).toBe(false);
  });

  it('a start whose signal already aborted opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(volcengineAst2Provider.start(
      { context: AUTO_CTX, config: configFor(), credentials: APP_KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(opened).not.toHaveBeenCalled();
  });

  it("loads an old profile as it was: the legacy mode, an App ID stored as a number read as text, the zhen pair repaired, nothing written", async () => {
    stored.set('settings.volcengineAST2.appId', 123456);
    stored.set('settings.volcengineAST2.accessToken', 'tok');
    stored.set('settings.volcengineAST2.hotWordTableId', 'hot-1');
    stored.set('settings.volcengineAST2.sourceLanguage', 'zhen');
    stored.set('settings.volcengineAST2.targetLanguage', 'en');
    await useProviderStore.getState().load(volcengineAst2Provider);
    const entry = useProviderStore.getState().entries.volcengine_ast2;
    expect(entry.settings as Ast2Settings).toEqual({ ...AST2_DEFAULTS, hotWordTableId: 'hot-1' });
    expect(readCredentials(volcengineAst2Provider, entry.settings, entry.credentials, { signedIn: false, getToken: async () => null })).toEqual({ kind: 'app', appKey: '123456', accessKey: 'tok' });
    expect(entry.pair).toEqual({ source: 'zhen', target: 'zhen' });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("keeps a text-only pair stored while a run would speak, and offers it back once text only is on (choice 1)", async () => {
    stored.set('settings.volcengineAST2.sourceLanguage', 'ko');
    stored.set('settings.volcengineAST2.targetLanguage', 'zh');
    await useProviderStore.getState().load(volcengineAst2Provider);
    expect(useProviderStore.getState().entries.volcengine_ast2.pair).toEqual({ source: 'zh', target: 'en' });
    useProviderStore.getState().setSpeech({ textOnly: true, participantSpeech: false });
    expect(useProviderStore.getState().entries.volcengine_ast2.pair).toEqual({ source: 'ko', target: 'zh' });
    expect(setSetting).not.toHaveBeenCalled();
  });
});
