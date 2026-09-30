import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Provider } from '../types/Provider';
import { buildDefaultLocalPrompt } from '../lib/local-inference/prompts';
import useLogStore from './logStore';

// Force platform detection so environment-gated providers are present in the
// descriptor registry. createSessionConfig now dispatches through
// ProviderConfigFactory.getDescriptor, which throws for unregistered
// providers. Mirrors descriptorRegistry.test.ts.
vi.mock('../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
}));

// Mock ServiceFactory first
const mockSetSetting = vi.fn().mockResolvedValue(undefined);
const mockGetSetting = vi.fn();
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: mockSetSetting,
      getSetting: mockGetSetting,
    })),
  },
}));

// Import after mocking
const {
  default: useSettingsStore,
  clampChunkSentences,
} = await import('./settingsStore');

describe('settingsStore', () => {
  beforeEach(() => {
    // Reset the store before each test
    useSettingsStore.setState({
      provider: Provider.OPENAI,
      isValidating: false,
      cacheTimestamp: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Provider Switching', () => {
    it('should set provider and clear cache without calling validateApiKey', async () => {
      // setProvider no longer calls validateApiKey directly —
      // validation is delegated to SettingsInitializer which reacts to provider changes.
      const store = useSettingsStore.getState();

      // Set some cache data first
      useSettingsStore.setState({
        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
        availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
        isApiKeyValid: true,
      });

      // Switch to Gemini
      await store.setProvider(Provider.GEMINI);

      // Provider should be updated
      expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);

      // Cache should be cleared (availableModels reset, validationCache empty)
      const state = useSettingsStore.getState();
      expect(state.availableModels).toEqual([]);
      expect(state.isApiKeyValid).toBeNull();
    });

    it('should NOT trigger auto-validation when switching to KizunaAI provider', async () => {
      const store = useSettingsStore.getState();

      // Mock validateApiKey
      const validateSpy = vi.spyOn(store, 'validateApiKey').mockImplementation(async () => {
        useSettingsStore.setState({ isValidating: true });
        useSettingsStore.setState({
          isValidating: false,
        });
        // The real action resolves to a result its callers read. The stub used
        // to resolve to undefined, which only type-checked because the store's
        // inference was broken; a caller awaiting this got undefined where the
        // contract promised an object.
        return { valid: true, message: '', validating: false };
      });

      // Switch provider
      await store.setProvider(Provider.LOCAL_NATIVE);

      // validateApiKey should NOT be called from setProvider (handled by SettingsInitializer)
      expect(validateSpy).not.toHaveBeenCalled();

      // Provider should be updated
      expect(useSettingsStore.getState().provider).toBe(Provider.LOCAL_NATIVE);
    });

    it('should clear cache when switching providers', async () => {
      // Set some cache data
      useSettingsStore.setState({
        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
        availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
        isApiKeyValid: true,
      });

      // Switch provider
      await useSettingsStore.getState().setProvider(Provider.GEMINI);

      // Verify cache was cleared by checking state (not spy)
      const state = useSettingsStore.getState();
      expect(state.validationCache.size).toBe(0);
      expect(state.availableModels).toEqual([]);
      expect(state.isApiKeyValid).toBeNull();
    });

    it('should persist provider change to settings service', async () => {
      // Switch provider
      await useSettingsStore.getState().setProvider(Provider.LOCAL_NATIVE);

      // Check that settings service was called
      expect(mockSetSetting).toHaveBeenCalledWith(
        'settings.common.provider',
        Provider.LOCAL_NATIVE
      );
    });
  });

  describe('Cache Management', () => {
    it('should clear cache and reset validation state', () => {
      // Set initial state with cache
      useSettingsStore.setState({
        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
        availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
        isApiKeyValid: true,
      });

      // Clear cache
      useSettingsStore.getState().clearCache();

      // Check state was reset
      const state = useSettingsStore.getState();
      expect(state.validationCache.size).toBe(0);
      expect(state.availableModels).toEqual([]);
      expect(state.isApiKeyValid).toBeNull();
    });
  });

  describe('keepReplayAudio', () => {
    it('defaults to false when storage has no stored value (loadSettings fallback)', async () => {
      // Mutate state to the OPPOSITE of the expected default first, so that
      // a passing assertion proves loadSettings() actually wrote the default
      // through — not that the field happened to already be false.
      useSettingsStore.setState({ keepReplayAudio: true });

      // Mock getSetting to behave like a fresh install: every key is missing,
      // so the SettingsService returns the caller-supplied fallback. The
      // fallback for keepReplayAudio is `defaultCommonSettings.keepReplayAudio`
      // (which is the source of truth this test guards).
      mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);

      await useSettingsStore.getState().loadSettings();

      expect(useSettingsStore.getState().keepReplayAudio).toBe(false);
    });

    it('setKeepReplayAudio(true) updates state and persists', async () => {
      mockSetSetting.mockResolvedValueOnce(undefined);
      await useSettingsStore.getState().setKeepReplayAudio(true);
      expect(useSettingsStore.getState().keepReplayAudio).toBe(true);
      expect(mockSetSetting).toHaveBeenCalledWith(
        'settings.common.keepReplayAudio',
        true,
      );
    });

    it('rolls back state when persistence fails', async () => {
      useSettingsStore.setState({ keepReplayAudio: false });
      mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
      await useSettingsStore.getState().setKeepReplayAudio(true);
      // State must roll back to the previous value.
      expect(useSettingsStore.getState().keepReplayAudio).toBe(false);
    });
  });

  describe('clampChunkSentences', () => {
    it.each([
      // 0 is Auto, and is now a value in its own right (Amendment A2).
      [0, 0], [1, 1], [3, 3], [5, 5],
      [-4, 0], [6, 5], [99, 5],
      [2.4, 2], [2.6, 3],
      ['3', 3], [null, 3], [undefined, 3], [NaN, 3], ['abc', 3],
    ])('clamps %s to %i', (input, expected) => {
      expect(clampChunkSentences(input)).toBe(expected);
    });

    // `null` means the setting is absent, so it must take the default 3 and
    // not fall through to `Number(null) === 0`, which since A2 is a valid
    // value — Auto — and would silently switch the feature's shape.
    it('does not read a missing value as Auto', () => {
      expect(clampChunkSentences(null)).not.toBe(0);
    });
  });

  describe('segmentationMode', () => {
    // One stored value for every provider: `pause` resolves to By pause on
    // the three clients with timers of their own and to Off everywhere else,
    // so the default is what every provider does today.
    it('defaults to pause', async () => {
      useSettingsStore.setState({ segmentationMode: 'sentences' });
      mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().segmentationMode).toBe('pause');
    });

    it('takes the default for a stored mode this build does not know', async () => {
      mockGetSetting.mockImplementation(async (key: string, fallback: unknown) =>
        key === 'settings.common.segmentationMode' ? 'enabled' : fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().segmentationMode).toBe('pause');
    });

    it('persists a change', async () => {
      mockSetSetting.mockResolvedValueOnce(undefined);
      await useSettingsStore.getState().setSegmentationMode('sentences');
      expect(useSettingsStore.getState().segmentationMode).toBe('sentences');
      expect(mockSetSetting).toHaveBeenCalledWith('settings.common.segmentationMode', 'sentences');
    });

    it('rolls back when persistence fails', async () => {
      useSettingsStore.setState({ segmentationMode: 'pause' });
      mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
      await useSettingsStore.getState().setSegmentationMode('off');
      expect(useSettingsStore.getState().segmentationMode).toBe('pause');
    });
  });

  // Seconds, one pair for every provider that cuts on its own timers. The
  // per-provider copies in the OpenAI Live and OpenAI Translate slices are
  // gone; these replace them.
  describe('segmentation pause durations', () => {
    it('both default to 1.5s', async () => {
      useSettingsStore.setState({ segmentationSourcePause: 0.4, segmentationTranslationPause: 0.4 });
      mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().segmentationSourcePause).toBe(1.5);
      expect(useSettingsStore.getState().segmentationTranslationPause).toBe(1.5);
    });

    it('clamps a stored value to 0.1-3', async () => {
      mockGetSetting.mockImplementation(async (key: string, fallback: unknown) => {
        if (key === 'settings.common.segmentationSourcePause') return 0;
        if (key === 'settings.common.segmentationTranslationPause') return 42;
        return fallback;
      });
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().segmentationSourcePause).toBe(0.1);
      expect(useSettingsStore.getState().segmentationTranslationPause).toBe(3);
    });

    it('takes the default for a stored value that is not a number', async () => {
      mockGetSetting.mockImplementation(async (key: string, fallback: unknown) =>
        key === 'settings.common.segmentationSourcePause' ? 'quick' : fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().segmentationSourcePause).toBe(1.5);
    });

    it('persists a change and clamps before writing', async () => {
      mockSetSetting.mockResolvedValue(undefined);
      await useSettingsStore.getState().setSegmentationSourcePause(9);
      expect(useSettingsStore.getState().segmentationSourcePause).toBe(3);
      expect(mockSetSetting).toHaveBeenCalledWith('settings.common.segmentationSourcePause', 3);

      await useSettingsStore.getState().setSegmentationTranslationPause(0.05);
      expect(useSettingsStore.getState().segmentationTranslationPause).toBe(0.1);
      expect(mockSetSetting).toHaveBeenCalledWith('settings.common.segmentationTranslationPause', 0.1);
    });

    it('rolls back when persistence fails', async () => {
      useSettingsStore.setState({ segmentationSourcePause: 1.5, segmentationTranslationPause: 1.5 });
      mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
      await useSettingsStore.getState().setSegmentationSourcePause(2);
      expect(useSettingsStore.getState().segmentationSourcePause).toBe(1.5);

      mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
      await useSettingsStore.getState().setSegmentationTranslationPause(2);
      expect(useSettingsStore.getState().segmentationTranslationPause).toBe(1.5);
    });

    // The seconds above and the milliseconds a client's timer takes are the
    // same three facts. Each used to be written out twice — a store that
    // defaulted to 1.5 and a client that fell back to 1500 could have drifted
    // apart with both their own tests still green.
    it('is the same default and the same range the clients clamp to', async () => {
      const {
        DEFAULT_SEGMENT_PAUSE_MS, MIN_SEGMENT_PAUSE_MS, MAX_SEGMENT_PAUSE_MS,
        DEFAULT_SEGMENT_PAUSE_SECONDS, MIN_SEGMENT_PAUSE_SECONDS, MAX_SEGMENT_PAUSE_SECONDS,
      } = await import('../lib/segmentation/segmentationMode');
      expect(DEFAULT_SEGMENT_PAUSE_SECONDS * 1000).toBe(DEFAULT_SEGMENT_PAUSE_MS);
      expect(MIN_SEGMENT_PAUSE_SECONDS * 1000).toBe(MIN_SEGMENT_PAUSE_MS);
      expect(MAX_SEGMENT_PAUSE_SECONDS * 1000).toBe(MAX_SEGMENT_PAUSE_MS);

      mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().segmentationSourcePause).toBe(DEFAULT_SEGMENT_PAUSE_SECONDS);
      expect(useSettingsStore.getState().segmentationTranslationPause).toBe(DEFAULT_SEGMENT_PAUSE_SECONDS);

      mockSetSetting.mockResolvedValue(undefined);
      await useSettingsStore.getState().setSegmentationSourcePause(99);
      expect(useSettingsStore.getState().segmentationSourcePause).toBe(MAX_SEGMENT_PAUSE_SECONDS);
      await useSettingsStore.getState().setSegmentationSourcePause(0);
      expect(useSettingsStore.getState().segmentationSourcePause).toBe(MIN_SEGMENT_PAUSE_SECONDS);
    });
  });

  describe('sentenceSegmentationChunkSentences', () => {
    it('defaults to 3', async () => {
      useSettingsStore.setState({ sentenceSegmentationChunkSentences: 5 });
      mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(3);
    });

    // ...and it is the same 3 every client falls back to; see
    // descriptorRegistry.test.ts for the other end of that tie.
    it('defaults to the one chunk constant, not a second copy of it', async () => {
      const { DEFAULT_CHUNK_SENTENCES } = await import('../lib/segmentation/segmentationMode');
      mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(DEFAULT_CHUNK_SENTENCES);
      expect(clampChunkSentences(null)).toBe(DEFAULT_CHUNK_SENTENCES);
    });

    it('keeps a stored 0, which is Auto', async () => {
      mockGetSetting.mockImplementation(async (key: string, fallback: unknown) =>
        key === 'settings.common.sentenceSegmentationChunkSentences' ? 0 : fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(0);
    });

    it('persists Auto', async () => {
      mockSetSetting.mockResolvedValueOnce(undefined);
      await useSettingsStore.getState().setSentenceSegmentationChunkSentences(0);
      expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(0);
      expect(mockSetSetting).toHaveBeenCalledWith('settings.common.sentenceSegmentationChunkSentences', 0);
    });

    it('clamps a stored value that is out of range', async () => {
      mockGetSetting.mockImplementation(async (key: string, fallback: unknown) =>
        key === 'settings.common.sentenceSegmentationChunkSentences' ? 42 : fallback);
      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(5);
    });

    it('persists a change and clamps before writing', async () => {
      mockSetSetting.mockResolvedValueOnce(undefined);
      await useSettingsStore.getState().setSentenceSegmentationChunkSentences(9);
      expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(5);
      expect(mockSetSetting).toHaveBeenCalledWith('settings.common.sentenceSegmentationChunkSentences', 5);
    });

    it('rolls back when persistence fails', async () => {
      useSettingsStore.setState({ sentenceSegmentationChunkSentences: 3 });
      mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
      await useSettingsStore.getState().setSentenceSegmentationChunkSentences(1);
      expect(useSettingsStore.getState().sentenceSegmentationChunkSentences).toBe(3);
    });
  });

  // Diagnostic logs are opt-in (Help). The setting is the switch the log store
  // obeys: persisted, off by default, and applied to the log store both when
  // it changes and when the settings load at startup.
  describe('diagnosticLogs', () => {
    afterEach(() => { useLogStore.getState().setEnabled(true); });

    it('defaults to off and switches the log store off when settings load', async () => {
      useSettingsStore.setState({ diagnosticLogs: true });
      useLogStore.getState().setEnabled(true);
      mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);

      await useSettingsStore.getState().loadSettings();

      expect(useSettingsStore.getState().diagnosticLogs).toBe(false);
      expect(useLogStore.getState().enabled).toBe(false);
    });

    it('keeps the log store on when the stored switch is on', async () => {
      useLogStore.getState().setEnabled(true);
      mockGetSetting.mockImplementation(async (key: string, fallback: unknown) =>
        key === 'settings.common.diagnosticLogs' ? true : fallback);

      await useSettingsStore.getState().loadSettings();

      expect(useSettingsStore.getState().diagnosticLogs).toBe(true);
      expect(useLogStore.getState().enabled).toBe(true);
    });

    it('setDiagnosticLogs persists and drives the log store', async () => {
      useLogStore.getState().setEnabled(false);
      mockSetSetting.mockResolvedValue(undefined);

      await useSettingsStore.getState().setDiagnosticLogs(true);
      expect(useSettingsStore.getState().diagnosticLogs).toBe(true);
      expect(mockSetSetting).toHaveBeenCalledWith('settings.common.diagnosticLogs', true);
      expect(useLogStore.getState().enabled).toBe(true);

      await useSettingsStore.getState().setDiagnosticLogs(false);
      expect(useLogStore.getState().enabled).toBe(false);
    });

    it('rolls back the setting and the log store when persistence fails', async () => {
      useSettingsStore.setState({ diagnosticLogs: false });
      useLogStore.getState().setEnabled(false);
      mockSetSetting.mockRejectedValueOnce(new Error('disk full'));

      await useSettingsStore.getState().setDiagnosticLogs(true);

      expect(useSettingsStore.getState().diagnosticLogs).toBe(false);
      expect(useLogStore.getState().enabled).toBe(false);
    });

    // The switch is read before anything else, so every later read — and any
    // warning a failed read raises — already runs under the user's choice. A
    // user with logs off has nothing recorded even while loading (PR #538
    // review: nothing may be logged before consent is known).
    it('applies the switch before reading any other setting', async () => {
      useLogStore.getState().setEnabled(false);
      const seen: Array<[string, boolean]> = [];
      mockGetSetting.mockImplementation(async (key: string, fallback: unknown) => {
        seen.push([key, useLogStore.getState().enabled]);
        return key === 'settings.common.diagnosticLogs' ? true : fallback;
      });

      await useSettingsStore.getState().loadSettings();

      expect(seen[0][0]).toBe('settings.common.diagnosticLogs');
      expect(seen.slice(1).every(([, enabled]) => enabled)).toBe(true);
    });

    // The store starts off. If even the switch cannot be read, it stays off:
    // the app runs on defaults, and the default is off.
    it('stays off when settings fail to load', async () => {
      useLogStore.getState().setEnabled(false);
      mockGetSetting.mockRejectedValue(new Error('storage unavailable'));

      await useSettingsStore.getState().loadSettings();

      expect(useLogStore.getState().enabled).toBe(false);
      mockGetSetting.mockReset();
    });

    // Once the switch has been read as on, a later setting failing to load is
    // exactly the kind of error an opted-in user turned logs on to see.
    it('keeps an opted-in user recording when a later setting fails to load', async () => {
      useLogStore.getState().setEnabled(false);
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === 'settings.common.diagnosticLogs') return true;
        throw new Error('storage unavailable');
      });

      await useSettingsStore.getState().loadSettings();

      expect(useLogStore.getState().enabled).toBe(true);
      mockGetSetting.mockReset();
    });
  });

  describe('autoSaveOnStop', () => {
    it('defaults to false when storage has no stored value (loadSettings fallback)', async () => {
      // Mutate state to the OPPOSITE of the expected default first, so that
      // a passing assertion proves loadSettings() actually wrote the default
      // through — not that the field happened to already be false.
      useSettingsStore.setState({ autoSaveOnStop: true });

      mockGetSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback);

      await useSettingsStore.getState().loadSettings();

      expect(useSettingsStore.getState().autoSaveOnStop).toBe(false);
    });

    it('setAutoSaveOnStop(true) updates state and persists', async () => {
      mockSetSetting.mockResolvedValueOnce(undefined);
      await useSettingsStore.getState().setAutoSaveOnStop(true);
      expect(useSettingsStore.getState().autoSaveOnStop).toBe(true);
      expect(mockSetSetting).toHaveBeenCalledWith(
        'settings.common.autoSaveOnStop',
        true,
      );
    });

    it('rolls back state when persistence fails', async () => {
      useSettingsStore.setState({ autoSaveOnStop: false });
      mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
      await useSettingsStore.getState().setAutoSaveOnStop(true);
      // State must roll back to the previous value.
      expect(useSettingsStore.getState().autoSaveOnStop).toBe(false);
    });
  });
});

describe('updateProviderSlice (public generic action)', () => {
  // No beforeEach reset needed here: unlike the top-level `settingsStore`
  // describe (which resets `provider`/validation fields consumed by
  // Provider Switching tests), every assertion below either checks a value
  // freshly written by the call under test or a relative before/after
  // snapshot — none depend on a slice's pristine default, so no adaptation
  // to the file's reset/persistence-mocking style was needed beyond the
  // module-level ServiceFactory mock already in effect for the whole file.

  it('merges a patch into the named slice', async () => {
    await useSettingsStore.getState().updateProviderSlice('localNative', { targetLanguage: 'ja' });
    expect(useSettingsStore.getState().localNative.targetLanguage).toBe('ja');
  });

  it('does not drop unpatched fields', async () => {
    const sourceBefore = useSettingsStore.getState().localNative.sourceLanguage;
    await useSettingsStore.getState().updateProviderSlice('localNative', { targetLanguage: 'ko' });
    expect(useSettingsStore.getState().localNative.sourceLanguage).toBe(sourceBefore);
  });

  it('rejects an unknown slice key', async () => {
    await expect(
      useSettingsStore.getState().updateProviderSlice('not-a-slice', { x: 1 })
    ).rejects.toThrow();
  });

  it('rejects prototype-chain names', async () => {
    await expect(
      useSettingsStore.getState().updateProviderSlice('toString', { x: 1 })
    ).rejects.toThrow();
  });

  it('behaves identically to the named per-provider action', async () => {
    await useSettingsStore.getState().updateProviderSlice('localNative', { targetLanguage: 'de' });
    const viaGeneric = useSettingsStore.getState().localNative;
    await useSettingsStore.getState().updateLocalNative({ targetLanguage: 'de' });
    expect(useSettingsStore.getState().localNative).toEqual(viaGeneric);
  });
});

describe('local_native asrDevice setting', () => {
  it('local_native session config carries the asrDevice override', () => {
    useSettingsStore.setState({
      provider: Provider.LOCAL_NATIVE,
      localNative: {
        ...useSettingsStore.getState().localNative,
        asrDevice: 'cpu',
      },
    } as any);
    const config = useSettingsStore.getState().createSessionConfig('sys');
    expect((config as any).asrDevice).toBe('cpu');
  });
});

describe('getProcessedLocalPrompt', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      provider: Provider.LOCAL_NATIVE,
      localNative: {
        ...useSettingsStore.getState().localNative,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        useTemplateMode: true,
        systemPrompt: '',
      },
    });
  });

  it('Simple mode: returns the dynamic default for speaker direction', () => {
    const result = useSettingsStore.getState().getProcessedLocalPrompt(false);
    expect(result).toBe(buildDefaultLocalPrompt('ja', 'en'));
  });

  it('Simple mode: swaps languages for participant direction', () => {
    const result = useSettingsStore.getState().getProcessedLocalPrompt(true);
    expect(result).toBe(buildDefaultLocalPrompt('en', 'ja'));
  });

  it('Advanced mode: returns the user speaker prompt verbatim', () => {
    useSettingsStore.setState({
      localNative: {
        ...useSettingsStore.getState().localNative,
        useTemplateMode: false,
        systemPrompt: 'My custom speaker prompt',
      },
    });
    const result = useSettingsStore.getState().getProcessedLocalPrompt(false);
    expect(result).toBe('My custom speaker prompt');
  });

  it('Advanced mode: empty speaker falls back to default', () => {
    useSettingsStore.setState({
      localNative: {
        ...useSettingsStore.getState().localNative,
        useTemplateMode: false,
        systemPrompt: '',
      },
    });
    const result = useSettingsStore.getState().getProcessedLocalPrompt(false);
    expect(result).toBe(buildDefaultLocalPrompt('ja', 'en'));
  });

  it('Advanced mode: the participant takes the speaker prompt (Local Native has none of its own)', () => {
    useSettingsStore.setState({
      localNative: {
        ...useSettingsStore.getState().localNative,
        useTemplateMode: false,
        systemPrompt: 'Speaker says hi',
      },
    });
    const result = useSettingsStore.getState().getProcessedLocalPrompt(true);
    expect(result).toBe('Speaker says hi');
  });

  it('Advanced mode: an empty prompt falls back to the default in both directions', () => {
    useSettingsStore.setState({
      localNative: {
        ...useSettingsStore.getState().localNative,
        useTemplateMode: false,
        systemPrompt: '',
      },
    });
    const speaker = useSettingsStore.getState().getProcessedLocalPrompt(false);
    const participant = useSettingsStore.getState().getProcessedLocalPrompt(true);
    expect(speaker).toBe(buildDefaultLocalPrompt('ja', 'en'));
    expect(participant).toBe(buildDefaultLocalPrompt('en', 'ja'));
  });
});
