import { FlaskConical } from 'lucide-react';
import { AUTO } from '../../lib/provider/languages';
import type { LanguageOption, Provider } from '../../lib/provider/types';
import { createFakeAdapter, type FakeConfig, type FakeCredentials } from './adapter';
import { FakeSettingsView } from './FakeSettingsView';
import { fakeScript } from './scripts';
import { FAKE_DEFAULTS, migrateFakeSettings, type FakeSettings } from './settings';

const LANGUAGES: readonly LanguageOption[] = [
  { value: 'en', name: 'English', englishName: 'English' },
  { value: 'ja', name: '日本語', englishName: 'Japanese' },
  { value: 'zh', name: '中文', englishName: 'Chinese' },
];

const adapter = createFakeAdapter();

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
  check: async (_k, s) => (s.checkFails ? { ok: false, reason: 'The fake reports not ready (fault knob).' } : { ok: true }),

  languages: {
    sources: () => [{ value: AUTO, name: 'Auto', englishName: 'Auto' }, ...LANGUAGES],
    targets: (source) => LANGUAGES.filter((l) => l.value !== source),
  },

  speech: 'optional',
  textInput: true,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: (_context, s) => (s.buildRefused
    ? { refused: 'The fake refuses to build (fault knob).' }
    : {
        script: fakeScript(s.script),
        faults: {
          startThrows: s.startThrows ? 'The fake failed to start (fault knob).' : undefined,
          startDelayMs: s.startDelayMs || undefined,
          failAfterMs: s.failAfterMs || undefined,
        },
      }),
  describe: () => ({ asrModel: 'fake', translationModel: 'fake', ttsModel: 'fake' }),
  start: adapter.start,
};
