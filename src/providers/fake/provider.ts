import { FlaskConical } from 'lucide-react';
import type { Adapter, AdapterEvents, AdapterSession, SessionContext, StartRequest } from '../../lib/contract/adapter';
import { AUTO } from '../../lib/provider/languages';
import type { CheckResult, LanguageOption, Provider, ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { createFakeAdapter, type FakeConfig, type FakeCredentials } from './adapter';
import { FakeSettingsView } from './FakeSettingsView';
import { fakeScript } from './scripts';
import { FAKE_DEFAULTS, migrateFakeSettings, type FakeSettings } from './settings';

const LANGUAGES: readonly LanguageOption[] = [
  { value: 'en', name: 'English', englishName: 'English' },
  { value: 'ja', name: '日本語', englishName: 'Japanese' },
  { value: 'zh', name: '中文', englishName: 'Chinese' },
];

// Built on the first `start()`, not here: a module-scope `createFakeAdapter()`
// call cannot be proven side-effect free, so a bundler keeps the whole module
// even once DEV-only tree-shaking (registry.ts) drops every reference to it —
// against D24, "compiled into development builds only" (final review, M1).
let adapter: Adapter<FakeConfig, FakeCredentials> | null = null;

/** The fake's language lists: `AUTO` and three languages as sources, never a source as its own target. */
export const FAKE_LANGUAGES: Provider<FakeSettings, FakeCredentials, FakeConfig>['languages'] = {
  sources: () => [{ value: AUTO, name: 'Auto', englishName: 'Auto' }, ...LANGUAGES],
  targets: (source) => LANGUAGES.filter((l) => l.value !== source),
};

/** Ready, unless `checkFails` is on. */
export async function checkFake(_k: unknown, s: FakeSettings): Promise<CheckResult> {
  return s.checkFails ? { ok: false, reason: 'The fake reports not ready (fault knob).' } : { ok: true };
}

/** One leg's config: its script and the fault knobs, or a refusal when `buildRefused` is on. */
export function buildFake(context: SessionContext, s: FakeSettings, shared: SharedSettings): FakeConfig | ProviderRefusal {
  return s.buildRefused
    ? { refused: 'The fake refuses to build (fault knob).', code: 'fake_build_refused', params: { knob: 'buildRefused' } }
    : {
        // the participant leg plays its own script when one is chosen (F10): a different shape per leg
        script: fakeScript(shared.reversed(context.direction) && s.participantScript !== 'same' ? s.participantScript : s.script),
        faults: {
          startThrows: s.startThrows ? 'The fake failed to start (fault knob).' : undefined,
          startDelayMs: s.startDelayMs || undefined,
          failAfterMs: s.failAfterMs || undefined,
        },
      };
}

/** The models a fake run reports. */
export const describeFake = () => ({ asrModel: 'fake', translationModel: 'fake', ttsModel: 'fake' });

/** The fake's adapter, built on the first start (never at module scope: D24). Generic, so the leased fake's wider config and credentials pass through. */
export function startFake<C extends FakeConfig, K>(request: StartRequest<C, K>, events: AdapterEvents): Promise<AdapterSession> {
  return (adapter ??= createFakeAdapter()).start(request as unknown as StartRequest<FakeConfig, FakeCredentials>, events);
}

/**
 * The fake provider (D24): a real definition, compiled into development builds
 * only, whose adapter plays a timed script. Its settings pick the script and
 * turn faults on, so every generic path — credentials, readiness, a refused
 * build, a failing start — can be driven without a network or a model.
 */
export const fakeProvider: Provider<FakeSettings, FakeCredentials, FakeConfig> & { id: 'fake' } = {
  id: 'fake',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: FlaskConical,
  vendor: 'Sokuji',

  settings: { key: 'fake', defaults: FAKE_DEFAULTS, migrate: migrateFakeSettings },
  Settings: FakeSettingsView,

  credentials: {
    keys: ['apiKey'],
    fields: (s) => (s.requireKey ? [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true }] : []),
    // `values` holds exactly the fields shown: nothing at all unless requireKey is on.
    read: (values): FakeCredentials | { missing: string } => (values.apiKey === '' ? { missing: 'Type any key: the fake accepts anything.' } : {}),
  },
  check: checkFake,

  languages: FAKE_LANGUAGES,

  speech: 'optional',
  textInput: true,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildFake,
  describe: describeFake,
  start: startFake,
};
