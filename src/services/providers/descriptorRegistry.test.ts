import { describe, it, expect, vi } from 'vitest';
// Force the Local Native gate on, plus Electron platform detection, so every
// descriptor registers regardless of build env.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
}));
import { ProviderConfigFactory } from './ProviderConfigFactory';
import { resolveSegmentationOffer } from './ProviderConfig';
import type { SegmentationOffer } from '../../lib/segmentation/segmentationMode';
import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
import { Provider } from '../../types/Provider';
import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
import en from '../../locales/en/translation.json';

// Map each provider's settingsSliceKey to its per-module default settings slice,
// so buildSessionConfig can be exercised for every registered provider.
const DEFAULTS_BY_SLICE: Record<string, unknown> = {
  localNative: defaultLocalNativeSettings,
};

describe('provider registry descriptors', () => {
  it('returns a descriptor for every available provider', () => {
    const ids = ProviderConfigFactory.getAvailableProviders();
    expect(ids.length).toBe(1);
    for (const id of ids) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(d.getConfig().id).toBe(id);
      expect(typeof d.settingsSliceKey).toBe('string');
    }
  });

  it('slice keys are unique', () => {
    const keys = ProviderConfigFactory.getAvailableProviders()
      .map(id => ProviderConfigFactory.getDescriptor(id).settingsSliceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('descriptor.createClient', () => {
  const creds = { ok: true as const, primary: 'k', secret: 's', endpoint: 'https://e.example' };
  const ws = { transport: 'websocket' as const };

  it('constructs a client for every available provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, ws);
      expect(client.getProvider()).toBe(id);
    }
  });
});

describe('descriptor.buildSessionConfig', () => {
  it('builds a config whose provider tag matches, for every provider, from defaults', () => {
    const wireTag: Record<string, string> = {
      local_native: 'local_native',
    };
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const cfg = d.buildSessionConfig((DEFAULTS_BY_SLICE as any)[d.settingsSliceKey], 'instr');
      expect(cfg.provider).toBe(wireTag[id]);
    }
  });

});

describe('descriptor language rules', () => {
  it('default providers pass their config languages through', () => {
    // Local Native builds its config on each call, so the pass-through is by value.
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
    expect(d.resolveSourceLanguages()).toEqual(d.getConfig().languages);
  });
});

describe('descriptor i18n keys', () => {
  it('every available provider has name+description in the en catalog', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const key = d.i18nKey ?? id;
      const entry = (en as any).providers?.[key];
      expect(entry?.name, `providers.${key}.name`).toBeTruthy();
      expect(entry?.description, `providers.${key}.description`).toBeTruthy();
    }
  });
});

describe('registry invariants', () => {
  // (descriptor config id === registry key is already asserted by
  // 'returns a descriptor for every available provider' above.)

  // Exact expected settingsSliceKey per provider. A typo'd slice key (e.g. a
  // provider silently falling back to a differently-cased or misspelled key)
  // must fail this table lookup loudly, not just pass a generic typeof check.
  // Partial: the enum keeps ids whose old descriptors are gone (Stage 2
  // deletion, ruling C1), so every table below names only the providers the
  // old registry still registers.
  const EXPECTED_SLICE_KEYS: Partial<Record<Provider, string>> = {
    // Registered only under Electron with its gate on — both forced on by
    // this file's environment mock.
    [Provider.LOCAL_NATIVE]: 'localNative',
  };

  it('settingsSliceKey matches the exact expected value per provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const key = ProviderConfigFactory.getDescriptor(id).settingsSliceKey;
      expect(key, `settingsSliceKey for ${id}`).toBe(EXPECTED_SLICE_KEYS[id]);
    }
  });

  // Exact expected supportsWebRTC per provider. Relay/twin and non-WebRTC
  // providers must not silently inherit `true` from a base descriptor.
  const EXPECTED_SUPPORTS_WEBRTC: Partial<Record<Provider, boolean>> = {
    [Provider.LOCAL_NATIVE]: false,
  };

  it('supportsWebRTC matches the exact expected value per provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const supportsWebRTC = ProviderConfigFactory.getDescriptor(id).supportsWebRTC;
      expect(supportsWebRTC, `supportsWebRTC for ${id}`).toBe(EXPECTED_SUPPORTS_WEBRTC[id]);
    }
  });

  it('every settingsSliceKey exists in the settings store defaults', async () => {
    const { default: useSettingsStore } = await import('../../stores/settingsStore');
    const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const key = ProviderConfigFactory.getDescriptor(id).settingsSliceKey;
      expect(state[key], `slice '${key}' for ${id}`).toBeTypeOf('object');
    }
  });

  it('extractCredentials on an empty slice never returns ok (except credential-free providers)', async () => {
    const credentialFree = new Set([Provider.LOCAL_NATIVE]);
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      if (credentialFree.has(id)) continue;
      const r = await ProviderConfigFactory.getDescriptor(id).extractCredentials({}, {});
      expect(r.ok, id).toBe(false);
    }
  });
});

describe('S1 capability flags', () => {
  const PUSH_GATED: Partial<Record<Provider, string[] | undefined>> = {
    [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
  };

  const TEXT_INPUT: Partial<Record<Provider, boolean | undefined>> = {
    [Provider.LOCAL_NATIVE]: true,
  };

  const QUEUES_TEXT: Provider[] = [];
  const LOCAL_PROMPT: Provider[] = [Provider.LOCAL_NATIVE];

  const PTT_FINALIZATION: Partial<Record<Provider, { silenceTailFrames?: number; response: string } | undefined>> = {
    [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
  };

  // The segmentation offer of every provider, resolved — the default already
  // filled in — because that is the answer the mode resolvers act on. This
  // table IS the specification (segmentation design, Amendment A2).
  const SEGMENTATION: Partial<Record<Provider, SegmentationOffer>> = {
    // 1-5 is what slice 3 shipped on the local engines; phase 2 adds Auto,
    // where the VAD utterance is the boundary someone else already decided
    // and the stage only fills the punctuation in.
    [Provider.LOCAL_NATIVE]: { pause: false, auto: true, sizes: true },
  };

  const DEFAULT_OFFER: SegmentationOffer = { pause: false, auto: true, sizes: false };

  // `turnDetection.hasSilenceDuration` per provider. It has exactly one
  // reader — the slider inside `renderTurnDetectionSettings`, which
  // `hasTurnDetection: false` returns before ever reaching — so on a provider
  // without turn detection it renders nothing and must not claim to. A2 moved
  // the two pause clients' sliders into the segmentation section.
  const SILENCE_DURATION: Partial<Record<Provider, boolean>> = {
    [Provider.LOCAL_NATIVE]: false,
  };

  it('declares hasSilenceDuration exactly where the table says', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.turnDetection.hasSilenceDuration, `hasSilenceDuration for ${id}`)
        .toBe(SILENCE_DURATION[id]);
    }
  });

  it('never declares hasSilenceDuration where nothing can render it', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      if (!caps.turnDetection.hasSilenceDuration) continue;
      expect(caps.hasTurnDetection, `hasTurnDetection for ${id}, which claims a silence slider`)
        .toBe(true);
    }
  });

  it('declares pushGatedModes exactly where the settings vocabulary has push-gated modes', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.pushGatedModes, `pushGatedModes for ${id}`).toEqual(PUSH_GATED[id]);
    }
  });

  it('pushGatedModes entries are unique non-empty strings', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const modes = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities.pushGatedModes;
      if (!modes) continue;
      expect(modes.length, `non-empty list for ${id}`).toBeGreaterThan(0);
      expect(new Set(modes).size, `no duplicates for ${id}`).toBe(modes.length);
      for (const m of modes) expect(m, `non-empty mode string for ${id}`).toBeTruthy();
    }
  });

  it('declares supportsTextInput on exactly the five whitelisted providers', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.supportsTextInput, `supportsTextInput for ${id}`).toBe(TEXT_INPUT[id]);
    }
  });

  it('queuesTextWhileResponding only on providers that also support text input', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(!!caps.queuesTextWhileResponding, `queuesTextWhileResponding for ${id}`).toBe(QUEUES_TEXT.includes(id));
      if (caps.queuesTextWhileResponding) {
        expect(caps.supportsTextInput, `queueing implies text input for ${id}`).toBe(true);
      }
    }
  });

  it('usesLocalPromptTemplate only on the local providers', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(!!caps.usesLocalPromptTemplate, `usesLocalPromptTemplate for ${id}`).toBe(LOCAL_PROMPT.includes(id));
    }
  });

  it('pttFinalization matches the behavior table, with valid frame counts', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.pttFinalization, `pttFinalization for ${id}`).toEqual(PTT_FINALIZATION[id]);
      const frames = caps.pttFinalization?.silenceTailFrames;
      if (frames !== undefined) {
        expect(Number.isInteger(frames) && frames > 0, `positive integer frames for ${id}`).toBe(true);
      }
    }
  });

  it('offers the segmentation choices the table names, for every provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(resolveSegmentationOffer(caps), `segmentation offer for ${id}`).toEqual(SEGMENTATION[id]);
    }
  });

  it('declares segmentation only on the descriptors that deviate from the default', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      const deviates = JSON.stringify(SEGMENTATION[id]) !== JSON.stringify(DEFAULT_OFFER);
      expect(caps.segmentation !== undefined, `segmentation declared for ${id}`).toBe(deviates);
    }
  });

  it('every provider offers at least one of Auto and sizes, which By sentences needs', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const offer = resolveSegmentationOffer(ProviderConfigFactory.getDescriptor(id).getConfig().capabilities);
      expect(offer.auto || offer.sizes, `By sentences is runnable on ${id}`).toBe(true);
    }
  });

  // Eleven clients each write `options.sentencesPerChunk ?? 3`, and the
  // number also lives in the store's clamp, in `defaultSize()` and in
  // `segmentationForProvider`. This is what ties every one of those copies to
  // the single exported constant: change it, and any client still on a
  // literal 3 fails here.
  it('a client built with no size runs on the one chunk default', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const client = ProviderConfigFactory.getDescriptor(id).createClient(
        { ok: true, primary: 'k', secret: 's', endpoint: 'https://e.example' },
        { transport: 'websocket' },
      );
      expect((client as any).sentencesPerChunk, `chunk default for ${id}`)
        .toBe(DEFAULT_CHUNK_SENTENCES);
    }
  });

  it('declares no forcedTransport: Palabra, the one that did, went with its old code', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.forcedTransport, `no forcedTransport for ${id}`).toBeUndefined();
    }
  });
});

describe('S2 buildParticipantSessionConfig', () => {
  it('every descriptor answers with a ParticipantSessionResult shape', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = DEFAULTS_BY_SLICE[d.settingsSliceKey];
      const res = d.buildParticipantSessionConfig(slice, 'instr', { keepReplayAudio: false });
      expect(Array.isArray(res.notices), `notices array for ${id}`).toBe(true);
      if (res.config !== null) {
        expect(res.config.textOnly, `participant textOnly for ${id}`).toBe(true);
        expect(res.config.keepReplayAudio, `keepReplayAudio for ${id}`).toBe(false);
      }
    }
  });
});

describe('legacy façade credential guards (the deprecated ClientFactory path)', () => {
  // The production path runs extractCredentials first, but the @deprecated
  // façade accepts raw positional args — it must keep the old contract of
  // rejecting incomplete credentials instead of reaching provider clients
  // with `secret: undefined`.
  it('ClientFactory.createClient rejects an empty apiKey for credentialed providers', async () => {
    const { ClientFactory } = await import('../clients/ClientFactory');
    expect(() => ClientFactory.createClient('m', Provider.PALABRA_AI, ''))
      .toThrow(/API key is required/);
    // LOCAL_NATIVE has no credentials — must keep working with ''
    expect(ClientFactory.createClient('m', Provider.LOCAL_NATIVE, '')).toBeTruthy();
  });
});

describe('S3 reversesDirectionViaSourceLanguage', () => {
  const TRANSLATE = 'gemini-3.5-live-translate-preview';

  it('false for every descriptor, any model', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(d.reversesDirectionViaSourceLanguage(TRANSLATE), `${id}`).toBe(false);
      expect(d.reversesDirectionViaSourceLanguage(undefined), `${id}`).toBe(false);
    }
  });
});

describe('S3 planBothMode', () => {
  it('is inert for every descriptor in every mode', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      for (const mode of ['speaker', 'participant', 'both']) {
        expect(d.planBothMode(DEFAULTS_BY_SLICE[d.settingsSliceKey], mode), `${id}/${mode}`)
          .toEqual({ shared: false, split: false });
      }
    }
  });
});

describe('S4 prepareToStart', () => {
  it('is declared only where a provider has pre-start work (Local Native)', () => {
    const WITH_HOOK = [Provider.LOCAL_NATIVE];
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(typeof d.prepareToStart === 'function', `hook presence for ${id}`)
        .toBe(WITH_HOOK.includes(id));
    }
  });
});

describe('credentialFields (spec §1.8)', () => {
  const ctx = { getAuthToken: async () => 'session-token' };

  it('every descriptor declares the fields a user must fill, and filling exactly those completes its credentials', async () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(Array.isArray(d.credentialFields), `${id} credentialFields`).toBe(true);
      // Reuses DEFAULTS_BY_SLICE (declared above for the buildSessionConfig
      // sweep) as the mirror of settingsStore's PROVIDER_SLICE_REGISTRY
      // defaults — do NOT import settingsStore here (its import graph is the
      // Denied-ID blast radius this file's header warns about). Its value
      // type is `unknown`; the cast is required to spread it below (each
      // entry is a plain default*Settings data object, never anything else).
      const defaults = DEFAULTS_BY_SLICE[d.settingsSliceKey] as Record<string, unknown> | undefined;
      expect(defaults, `${id}: DEFAULTS_BY_SLICE lacks '${d.settingsSliceKey}' — add that provider's default*Settings export above`).toBeDefined();

      const filled: Record<string, unknown> = { ...defaults };
      for (const f of d.credentialFields) {
        expect(typeof f.key, `${id} field key`).toBe('string');
        expect(f.labelKey.startsWith('setup.credentials.'), `${id} ${f.key} labelKey`).toBe(true);
        filled[f.key] = f.secret ? 'sk-test-value' : 'https://example.test/v1';
      }
      const withFields = await d.extractCredentials(filled, ctx);
      expect(withFields.ok, `${id}: filling ${d.credentialFields.map((f) => f.key).join(',')} should complete credentials`).toBe(true);

      if (d.credentialFields.length > 0) {
        const bare = await d.extractCredentials({ ...defaults }, ctx);
        expect(bare.ok, `${id}: defaults alone must NOT be complete when fields are declared`).toBe(false);
      }
    }
  });

  it('credentialFieldsFor falls back to the declared fields when the slice says nothing', () => {
    // Descriptors whose slot depends on other settings (Soniox's region) may
    // vary the key, but never for a slice that carries no such setting — the
    // declared list stays the answer every other caller can rely on.
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(d.credentialFieldsFor({}), `${id} credentialFieldsFor({})`).toEqual(d.credentialFields);
    }
  });
});
