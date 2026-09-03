import React, { useState, useEffect, useMemo } from 'react';
import { Cpu, Zap, HelpCircle, CheckCircle, AlertCircle, ExternalLink, X } from 'lucide-react';
import { supportsBaseSelect } from '../../../utils/supportsBaseSelect';
import { OpenAIIcon, GeminiIcon, PalabraAIIcon, KizunaAIIcon, VolcengineIcon, ZoomIcon, SonioxIcon, KIZUNA_HOSTED_ICONS } from '../../Icons/ProviderIcons';
import { PoweredBy } from './PoweredBy';
import { EngineStatusLine } from './EngineStatusLine';
import { asSonioxRegion } from '../../../lib/soniox/regions';
import { sonioxKeyField } from '../../../services/providers/SonioxProviderConfig';
import { directionKey, type Stage, type DirectionResult } from '../../../lib/local-inference/selection/types';
import { Trans, useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import {
  useProvider,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useVolcengineSTSettings,
  useVolcengineAST2Settings,
  useZoomAISettings,
  useIsApiKeyValid,
  useSetProvider,
  useUpdateOpenAI,
  useUpdateGemini,
  useUpdateOpenAICompatible,
  useUpdatePalabraAI,
  useUpdateOpenAITranslate,
  useUpdateVolcengineST,
  useUpdateVolcengineAST2,
  useUpdateZoomAI,
  useUpdateSoniox,
  useValidateApiKey,
  useIsValidating,
  useValidationMessage,
  useIsKizunaKeyFetching,
  useKizunaKeyError,
  useUIMode,
  useNavigateToSettings,
  useSetEngineSlotTarget,
  useSetAccountPopoverRequested,
  useLocalInferenceSettings,
  useLocalNativeSettings,
  useSettingsStore,
} from '../../../stores/settingsStore';
import type { SettingsStore } from '../../../stores/settingsStore';
import { Provider, ProviderType, isKizunaManagedProvider } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { TUTORIAL_URLS } from '../../../services/providers/tutorialUrls';
import { openExternalUrl } from '../../../utils/openExternalUrl';
import { useAuth } from '../../../lib/auth/hooks';
import { useAnalytics } from '../../../lib/analytics';
import { useModelStore } from '../../../stores/modelStore';
import { useIsParticipantChannelInScope, useMode } from '../../../stores/audioStore';
import { useLockedMode } from '../../../stores/sessionStore';
import {
  getManifestEntry,
  estimateModelMemoryByDevice,
} from '../../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../../lib/local-inference/modelName';
import { useNativeModelStatuses, useNativeModelSizes, useNativeModelStore, useNativeCatalog, useNativeAsrResolved, useNativeTranslationResolved, useNativeSidecarStatus } from '../../../stores/nativeModelStore';
import {
  nativeAsrCards,
  nativeAsrIncompatibleCards,
  nativeTranslationCards,
  nativeTtsModels,
  estimateNativeMemoryByDevice,
  actualNativeMemoryByDevice,
  formatMemMb,
} from '../../../lib/local-inference/native/nativeCatalog';

// Icons are React components and stay in the UI layer — the descriptor only
// carries the i18n key (see i18nKey on ProviderDescriptor). Keys omitted here
// fall back to DefaultProviderIcon.
const PROVIDER_ICONS: Partial<Record<ProviderType, React.ComponentType<{ size?: string | number }>>> = {
  [Provider.OPENAI]: OpenAIIcon,
  [Provider.GEMINI]: GeminiIcon,
  [Provider.OPENAI_COMPATIBLE]: Zap,
  [Provider.OPENAI_TRANSLATE]: OpenAIIcon,
  [Provider.PALABRA_AI]: PalabraAIIcon,
  [Provider.VOLCENGINE_ST]: VolcengineIcon,
  [Provider.VOLCENGINE_AST2]: VolcengineIcon,
  [Provider.ZOOM_AI]: ZoomIcon,
  [Provider.SONIOX]: SonioxIcon,
  // The Kizuna-managed twins get "Kizuna AI, powered by <vendor>" composites —
  // the bare logo made all three indistinguishable here. Local inference has
  // no third-party engine to credit, so it keeps the plain logo.
  ...KIZUNA_HOSTED_ICONS,
  [Provider.LOCAL_INFERENCE]: KizunaAIIcon,
  [Provider.LOCAL_NATIVE]: KizunaAIIcon,
};
const DefaultProviderIcon = HelpCircle;


const DISMISSED_KEY = 'sokuji-dismissed-tutorials';

interface ProviderSectionProps {
  isSessionActive: boolean;
  /** Additional class name */
  className?: string;
}

const ProviderSection: React.FC<ProviderSectionProps> = ({
  isSessionActive,
  className = ''
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const { getToken, isSignedIn } = useAuth();

  // Settings store
  const provider = useProvider();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const palabraAISettings = usePalabraAISettings();
  const volcengineSTSettings = useVolcengineSTSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();
  const zoomAISettings = useZoomAISettings();
  const isApiKeyValid = useIsApiKeyValid();

  const setProvider = useSetProvider();
  const updateOpenAISettings = useUpdateOpenAI();
  const updateGeminiSettings = useUpdateGemini();
  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
  const updatePalabraAISettings = useUpdatePalabraAI();
  const updateOpenAITranslateSettings = useUpdateOpenAITranslate();
  const updateVolcengineSTSettings = useUpdateVolcengineST();
  const updateVolcengineAST2Settings = useUpdateVolcengineAST2();
  const updateZoomAISettings = useUpdateZoomAI();
  const updateSonioxSettings = useUpdateSoniox();
  const validateApiKey = useValidateApiKey();
  const isValidating = useIsValidating();
  const validationMessage = useValidationMessage();
  const isKizunaKeyFetching = useIsKizunaKeyFetching();
  const kizunaKeyError = useKizunaKeyError();
  const uiMode = useUIMode();
  const isSimpleMode = uiMode === 'basic';
  const navigateToSettings = useNavigateToSettings();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const setAccountPopoverRequested = useSetAccountPopoverRequested();

  // Local inference model info
  const localInferenceSettings = useLocalInferenceSettings();
  // Local native (sidecar) model info — separate settings slice + model store.
  const localNativeSettings = useLocalNativeSettings();
  const nativeModelStatuses = useNativeModelStatuses();
  const nativeModelSizes = useNativeModelSizes();
  const nativeCatalog = useNativeCatalog();
  const nativeRefresh = useNativeModelStore(s => s.refresh);
  const nativeRefreshCatalog = useNativeModelStore(s => s.refreshCatalog);
  const nativeStatus = useNativeSidecarStatus();

  // Live, resolved view of the native speaker (src→tgt) direction — selections
  // is the only source now, so the chips, memory estimate, and download-id
  // list all read resolve() output instead of flat settings fields.
  const nativeSpeakerResolved = useMemo(() => {
    if (provider !== Provider.LOCAL_NATIVE) return null;
    return useNativeModelStore.getState().resolve(
      localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage, localNativeSettings.selections);
  }, [provider, localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage,
    localNativeSettings.selections, nativeModelStatuses, nativeCatalog]);

  // The participant (tgt→src) direction is a peer of the speaker direction,
  // not a reversal of it — resolved against its own `selections` entry, same
  // as the WASM speakerResolved/participantResolved pair below. Feeds the
  // participant/both mode chip groups (Finding 1).
  const nativeParticipantResolved = useMemo(() => {
    if (provider !== Provider.LOCAL_NATIVE) return null;
    return useNativeModelStore.getState().resolve(
      localNativeSettings.targetLanguage, localNativeSettings.sourceLanguage, localNativeSettings.selections);
  }, [provider, localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage,
    localNativeSettings.selections, nativeModelStatuses, nativeCatalog]);

  // The sidecar download ids EITHER direction's current selection maps to —
  // both, unconditionally, so a mode flip (speaker <-> participant <-> both)
  // never shows a stale/incorrect chip while status for the other direction's
  // models catches up. Shared by the status refresh + the memory estimate so
  // both stay in sync with the chips.
  const nativeActiveDownloadIds = useMemo(() => {
    return [
      nativeSpeakerResolved?.asr?.modelId, nativeSpeakerResolved?.translation?.modelId, nativeSpeakerResolved?.tts?.modelId,
      nativeParticipantResolved?.asr?.modelId, nativeParticipantResolved?.translation?.modelId,
    ].filter((x): x is string => !!x);
  }, [nativeSpeakerResolved, nativeParticipantResolved]);

  // Pull cache status + sizes from the sidecar so the chips and estimate work even
  // when the model-management section isn't mounted (e.g. before opening Advanced).
  const nativeIdsKey = nativeActiveDownloadIds.join('|');
  useEffect(() => {
    if (provider !== Provider.LOCAL_NATIVE || nativeActiveDownloadIds.length === 0) return;
    nativeRefresh(nativeActiveDownloadIds);
    nativeRefreshCatalog(nativeActiveDownloadIds);  // tiers + sizes drive the cards + VRAM/RAM split below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, nativeIdsKey]);

  // Memory estimate for native — same "footprint ≈ on-disk model size" heuristic
  // as LOCAL_INFERENCE, but split into VRAM vs RAM per stage: a model lands in
  // VRAM when its device is forced to gpu, or left on auto AND the sidecar
  // reports an available GPU tier for it (so the resolver would run it on the
  // GPU). Each stage (ASR/translation/TTS) carries its own device override.
  const nativeMemoryEstimate = useMemo(() => {
    if (!nativeSpeakerResolved) return null;
    return estimateNativeMemoryByDevice([
      { id: nativeSpeakerResolved.asr?.modelId, device: localNativeSettings.asrDevice },
      { id: nativeSpeakerResolved.translation?.modelId, device: localNativeSettings.translationDevice },
      { id: nativeSpeakerResolved.tts?.modelId, device: localNativeSettings.ttsDevice },
    ], nativeModelSizes, nativeCatalog);
  }, [nativeSpeakerResolved, localNativeSettings.asrDevice, localNativeSettings.translationDevice,
    localNativeSettings.ttsDevice, nativeModelSizes, nativeCatalog]);

  const asrResolved = useNativeAsrResolved();
  const translationResolved = useNativeTranslationResolved();
  // Once a session resolves, replace the pre-session estimate with what's REALLY
  // in use — but only when the resolved stages still match the current selection
  // (else a prior session's numbers would mislead). Resolution carries the real
  // device, so a VRAM-degraded translation correctly shows up under RAM.
  const nativeActual = useMemo(() => {
    if (!nativeSpeakerResolved) return null;
    const asrMatch = !!asrResolved && asrResolved.model === nativeSpeakerResolved.asr?.modelId;
    const trMatch = !!translationResolved && translationResolved.model === nativeSpeakerResolved.translation?.modelId;
    if (!asrMatch || !trMatch) return null;
    const mem = actualNativeMemoryByDevice(asrResolved, translationResolved);
    const degraded = [asrResolved, translationResolved].some(r => r?.device === 'cpu' && r?.fallbackReason);
    return { ...mem, degraded };
  }, [asrResolved, translationResolved, nativeSpeakerResolved]);

  const isParticipantChannelInScope = useIsParticipantChannelInScope();
  // Effective audio mode — same `lockedMode ?? mode` idiom LanguageSection
  // uses for every other mode-scoped display: an in-session panel describes
  // the session that is actually running, not wherever the mode picker
  // currently sits. Drives which chip groups the model-info block below
  // renders (Finding 1: chips must follow the audio mode).
  const mode = useMode();
  const lockedMode = useLockedMode();
  const audioMode = lockedMode ?? mode;
  // Read model download statuses reactively so participant status updates when models are downloaded
  const modelStatuses = useModelStore(state => state.modelStatuses);
  // Live, resolved view of the WASM speaker (src→tgt) direction — same
  // resolve() the session-config builder uses.
  const speakerResolved = useMemo(() => {
    if (provider !== Provider.LOCAL_INFERENCE) return null;
    return useModelStore.getState().resolve(
      localInferenceSettings.sourceLanguage,
      localInferenceSettings.targetLanguage,
      localInferenceSettings.selections,
    );
  }, [provider, localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage, localInferenceSettings.selections, modelStatuses]);
  // The participant direction (target→source) is a peer of the speaker
  // direction, not a reversal of it: resolve it directly via the same
  // resolve() the session-config builder uses, against its own selections
  // entry — never derived from the speaker's chosen models.
  const participantResolved = useMemo(() => {
    if (provider !== Provider.LOCAL_INFERENCE) return null;
    return useModelStore.getState().resolve(
      localInferenceSettings.targetLanguage,
      localInferenceSettings.sourceLanguage,
      localInferenceSettings.selections,
    );
  }, [provider, localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage, localInferenceSettings.selections, modelStatuses]);

  const deviceFeatures = useModelStore(state => state.deviceFeatures);
  const memoryEstimate = useMemo(() => {
    if (provider !== Provider.LOCAL_INFERENCE || !speakerResolved) return null;
    // Skip cloud TTS models (e.g. Edge TTS) — they don't consume local memory
    const ttsId = speakerResolved.tts?.modelId;
    const ttsEntry = ttsId ? getManifestEntry(ttsId) : undefined;
    const effectiveTtsId = ttsEntry?.isCloudModel ? undefined : ttsId;

    const mainIds = [speakerResolved.asr?.modelId, speakerResolved.translation?.modelId, effectiveTtsId];
    const participantIds = isParticipantChannelInScope && participantResolved
      ? [participantResolved.asr?.modelId, participantResolved.translation?.modelId]
      : [];
    return estimateModelMemoryByDevice([...mainIds, ...participantIds], deviceFeatures);
  }, [provider, deviceFeatures, isParticipantChannelInScope, participantResolved, speakerResolved]);

  // Whether the provider select can render rich option markup (icons,
  // descriptions, engine credits). Stable for the life of the page, so a
  // one-shot init is enough.
  const [richSelect] = useState(() => supportsBaseSelect());

  const [dismissedTutorials, setDismissedTutorials] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      if (!stored) return new Set();
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
    } catch { return new Set(); }
  });

  const dismissTutorial = (providerId: string) => {
    const updated = new Set(dismissedTutorials);
    updated.add(providerId);
    setDismissedTutorials(updated);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...updated]));
  };

  const tutorialUrl = TUTORIAL_URLS[provider];

  // Shared by every model chip (both local providers, both speaker/
  // participant chip groups): deep-link the engine surface straight to this
  // slot instead of the old "flip the language pair" workflow. Takes the
  // direction EXPLICITLY rather than deriving it from the provider's stored
  // src/tgt — a participant-group chip targets the reverse direction, a
  // speaker-group chip the forward one, and each chip owns its own slot
  // (Finding 1: clicks target the CHIP'S OWN direction, never a hardcoded
  // one). Simple mode needs only the target — SimpleSettings' host reacts to
  // it directly. Advanced mode also has to switch to the provider tab; no
  // mode switch happens here (that's the whole point — the chip no longer
  // forces the user into Advanced).
  const openSlot = (dir: string, stage: Stage) => {
    setEngineSlotTarget({ dir, stage });
    if (!isSimpleMode) navigateToSettings('provider');
  };

  // ── Chip groups: mode-aware, shared by both local providers ─────────────
  //
  // - 'speaker'     → 3 chips (ASR/MT/TTS) for src→tgt.
  // - 'participant' → 2 chips (ASR/MT — no TTS) for the REVERSE tgt→src.
  // - 'both'        → both groups, each under a small-caps label so which
  //   group is whose is never ambiguous.
  //
  // `renderChips` renders one direction's chip row; it differs per provider
  // (native looks up catalog cards for display names, WASM reads the
  // manifest directly), so it's injected rather than hard-coded here.
  const renderChipGroups = (
    renderChips: (resolved: DirectionResult | null, src: string, tgt: string, includeTts: boolean) => React.ReactNode,
    speaker: DirectionResult | null,
    participant: DirectionResult | null,
    src: string,
    tgt: string,
  ): React.ReactNode => {
    if (audioMode === 'participant') {
      return <div className="model-inline">{renderChips(participant, tgt, src, false)}</div>;
    }
    if (audioMode === 'both') {
      return (
        <>
          <div className="model-inline-group">
            <span className="model-inline-group__label">{t('modePicker.modeYou', 'Me')}</span>
            <div className="model-inline">{renderChips(speaker, src, tgt, true)}</div>
          </div>
          <div className="model-inline-group">
            <span className="model-inline-group__label">{t('modePicker.modeParticipants', 'Other')}</span>
            <div className="model-inline">{renderChips(participant, tgt, src, false)}</div>
          </div>
        </>
      );
    }
    // 'speaker' (default)
    return <div className="model-inline">{renderChips(speaker, src, tgt, true)}</div>;
  };

  // LOCAL_NATIVE's chip row: card lookups go through the sidecar catalog.
  const renderNativeChips = (resolved: DirectionResult | null, src: string, tgt: string, includeTts: boolean): React.ReactNode => {
    const dir = directionKey(src, tgt);
    // resolve() only returns a stage when it's a usable (ready + hardware-ok)
    // candidate, so its presence already means "ready" — no separate
    // nativeModelStatuses check needed.
    const asrId = resolved?.asr?.modelId;
    const asrCard = asrId
      ? [...nativeAsrCards(src, nativeCatalog), ...nativeAsrIncompatibleCards(src, nativeCatalog)]
          .find(c => c.selectId === asrId)
      : undefined;
    const trId = resolved?.translation?.modelId;
    const trCard = trId
      ? nativeTranslationCards(src, tgt, nativeCatalog).find(c => c.selectId === trId)
      : undefined;
    return (
      <>
        <button type="button" className="model-chip" onClick={() => openSlot(dir, 'asr')}>
          <span className="model-chip-label">{t('providers.local_inference.modelAsr', 'ASR')}</span>
          <span className={`model-chip-value ${asrId ? 'model-ok' : 'model-warn'}`}>
            {asrId ? shortenModelName(asrCard?.name ?? asrId) : t('common.none', 'None')}
          </span>
        </button>
        <button type="button" className="model-chip" onClick={() => openSlot(dir, 'translation')}>
          <span className="model-chip-label">{t('providers.local_inference.modelTranslation', 'MT')}</span>
          <span className={`model-chip-value ${trId ? 'model-ok' : 'model-warn'}`}>
            {trId ? shortenModelName(trCard?.name ?? trId) : t('common.none', 'None')}
          </span>
        </button>
        {includeTts && (() => {
          const voiceId = resolved?.tts?.modelId;
          const ttsVoice = voiceId
            ? nativeTtsModels(tgt, nativeCatalog).find(m => m.id === voiceId)
            : undefined;
          return (
            <button type="button" className="model-chip" onClick={() => openSlot(dir, 'tts')}>
              <span className="model-chip-label">{t('providers.local_inference.modelTts', 'TTS')}</span>
              <span className={`model-chip-value ${voiceId ? 'model-ok' : 'model-warn'}`}>
                {voiceId ? shortenModelName(ttsVoice?.name ?? voiceId) : t('common.none', 'None')}
              </span>
            </button>
          );
        })()}
      </>
    );
  };

  // LOCAL_INFERENCE's chip row: reads the static WASM manifest directly.
  const renderInferenceChips = (resolved: DirectionResult | null, src: string, tgt: string, includeTts: boolean): React.ReactNode => {
    const dir = directionKey(src, tgt);
    // resolve() only returns a stage when it's a usable (ready + hardware-ok,
    // or always-ready cloud) candidate, so its presence already means
    // "ready" — no separate modelStatuses check needed.
    const asrId = resolved?.asr?.modelId;
    const trId = resolved?.translation?.modelId;
    const wasmShort = (id: string): string => {
      const entry = getManifestEntry(id);
      return entry ? shortenModelName(entry.name, entry.shortName) : id;
    };
    return (
      <>
        <button type="button" className="model-chip" onClick={() => openSlot(dir, 'asr')}>
          <span className="model-chip-label">{t('providers.local_inference.modelAsr', 'ASR')}</span>
          <span className={`model-chip-value ${asrId ? 'model-ok' : 'model-warn'}`}>
            {asrId ? wasmShort(asrId) : t('common.none', 'None')}
          </span>
        </button>
        <button type="button" className="model-chip" onClick={() => openSlot(dir, 'translation')}>
          <span className="model-chip-label">{t('providers.local_inference.modelTranslation', 'MT')}</span>
          <span className={`model-chip-value ${trId ? 'model-ok' : 'model-warn'}`}>
            {trId ? wasmShort(trId) : t('common.none', 'None')}
          </span>
        </button>
        {includeTts && (() => {
          const id = resolved?.tts?.modelId;
          return (
            <button type="button" className="model-chip" onClick={() => openSlot(dir, 'tts')}>
              <span className="model-chip-label">{t('providers.local_inference.modelTts', 'TTS')}</span>
              <span className={`model-chip-value ${id ? 'model-ok' : 'model-warn'}`}>
                {id ? wasmShort(id) : t('common.none', 'None')}
              </span>
            </button>
          );
        })()}
      </>
    );
  };

  // Get all available providers
  const availableProviders = useMemo(() => {
    return ProviderConfigFactory.getAllConfigs();
  }, []);

  // The persisted provider can be one the registry no longer carries — a
  // feature flag turned off since, or a selection made in Electron opened in
  // the extension (local_native, volcengine_ast2). getDescriptor throws for
  // those, and this component must survive them: the select renders the
  // stored value on a disabled placeholder option instead.
  const providerRegistered = ProviderConfigFactory.isProviderSupported(provider);

  // Get current API key based on provider — delegates to the descriptor's
  // peekPrimaryCredential so the per-provider credential shape lives in one
  // place instead of being hand-copied here (see also settingsStore.validateApiKey).
  // Subscribes reactively to whichever settings slice the current provider maps
  // to: a plain getState() snapshot wouldn't re-render this component as the
  // user types (OpenAI/Gemini/OpenAI Translate no longer have their own
  // dedicated settings hooks called here after the switch collapsed).
  const currentProviderSettingsSlice = useSettingsStore(
    (state) => providerRegistered
      ? state[ProviderConfigFactory.getDescriptor(provider).settingsSliceKey as keyof SettingsStore]
      : undefined
  );
  const getCurrentApiKey = (): string => {
    if (!providerRegistered) return '';
    return ProviderConfigFactory.getDescriptor(provider).peekPrimaryCredential(currentProviderSettingsSlice);
  };

  // Update API key based on provider
  const updateApiKey = (value: string) => {
    switch (provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ apiKey: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ apiKey: value });
        break;
      case Provider.OPENAI_COMPATIBLE:
        updateOpenAICompatibleSettings({ apiKey: value });
        break;
      case Provider.PALABRA_AI:
        if (palabraAISettings.authMode === 'platform') {
          updatePalabraAISettings({ apiKey: value });
        } else {
          updatePalabraAISettings({ clientId: value });
        }
        break;
      case Provider.OPENAI_TRANSLATE:
        updateOpenAITranslateSettings({ apiKey: value });
        break;
      case Provider.VOLCENGINE_ST:
        updateVolcengineSTSettings({ accessKeyId: value });
        break;
      case Provider.VOLCENGINE_AST2:
        updateVolcengineAST2Settings({ appId: value });
        break;
      case Provider.ZOOM_AI:
        updateZoomAISettings({ apiKey: value });
        break;
      case Provider.SONIOX:
        // The generic input edits the ACTIVE region's key: three regions mean
        // three independent credentials, and writing them all to `apiKey` would
        // overwrite the US key every time a regional one was pasted.
        updateSonioxSettings({
          [sonioxKeyField(asSonioxRegion((currentProviderSettingsSlice as { region?: string })?.region))]: value,
        });
        break;
    }
  };

  // Validate API key
  const handleValidateApiKey = async () => {
    const getAuthToken = isKizunaManagedProvider(provider) && isSignedIn && getToken ?
      () => getToken() : undefined;

    const result = await validateApiKey(getAuthToken, isSignedIn);

    trackEvent('api_key_validated', {
      provider: provider,
      success: result.valid === true
    });
  };

  // Handle provider switching
  const handleProviderChange = (newProvider: ProviderType) => {
    const oldProvider = provider;
    setProvider(newProvider);

    trackEvent('provider_switched', {
      from_provider: oldProvider || 'default',
      to_provider: newProvider,
      during_session: isSessionActive
    });
  };

  // Get provider info by ID. Name/description resolve through the descriptor's
  // i18n key (defaults to the provider id itself — see i18nKey on
  // ProviderDescriptor); icons stay in the UI layer via PROVIDER_ICONS.
  // Falls back to the 'unknown' catalog entry for a providerId that isn't
  // currently registered (e.g. a persisted selection whose feature flag was
  // since disabled) — mirrors the old switch's default arm.
  const getProviderInfoById = (providerId: ProviderType) => {
    if (!ProviderConfigFactory.isProviderSupported(providerId)) {
      return {
        name: t('providers.unknown.name'),
        icon: DefaultProviderIcon,
        description: t('providers.unknown.description'),
      };
    }
    const descriptor = ProviderConfigFactory.getDescriptor(providerId);
    const key = descriptor.i18nKey ?? providerId;
    return {
      name: t(`providers.${key}.name`),
      icon: PROVIDER_ICONS[providerId] ?? DefaultProviderIcon,
      description: t(`providers.${key}.description`),
    };
  };

  const currentApiKey = getCurrentApiKey();

  // One renderer for every provider option — the registered list and the
  // unregistered-placeholder both go through it, so the rich/plain split
  // (see richSelect) lives in exactly one place.
  const renderProviderOption = (id: ProviderType, disabled = false) => {
    const optionInfo = getProviderInfoById(id);
    // Whatever the wizard's managed card recommends, this list recommends —
    // same function, so the two surfaces cannot name different providers.
    const recommended = id === ProviderConfigFactory.getDefaultManagedProvider();
    const recommendedLabel = t('simpleSettings.recommended', 'Recommended');
    if (!richSelect) {
      // Chrome below 135 renders <option>{text}</option> and drops every child
      // element, so on the extension's floor (116) the claim has to be text.
      return (
        <option key={id} value={id} disabled={disabled}>
          {recommended
            ? t('simpleSettings.recommendedOption', '{{name}} ({{label}})', { name: optionInfo.name, label: recommendedLabel })
            : optionInfo.name}
        </option>
      );
    }
    return (
      <option key={id} value={id} disabled={disabled}>
        <span className="provider-select__icon">
          {React.createElement(optionInfo.icon, { size: 20 })}
        </span>
        <span className="provider-select__text">
          {/* Name and engine credit share one line: the managed twins are all
              named "KizunaAI", so the vendor is what tells them apart, and
              giving it its own line would make every row a line taller. */}
          <span className="provider-name-line">
            <span className="provider-select__name">{optionInfo.name}</span>
            <PoweredBy provider={id} />
            {recommended && <em className="provider-recommended">{recommendedLabel}</em>}
          </span>
          <span className="provider-select__description">{optionInfo.description}</span>
        </span>
      </option>
    );
  };

  return (
    <div className={`config-section provider-section ${className}`} id="provider-section" data-tour="provider-section">
      <h3>
        <Cpu size={18} />
        <span>{t('simpleSettings.provider', 'Provider')}</span>
        <Tooltip
          content={
            <div>
              <p>{t('settings.providerTooltip')}</p>
              <p style={{ marginTop: '8px' }}>{t('simpleSettings.apiKeyHelpTooltip2')}</p>
              <a
                href="https://sokuji.kizuna.ai/docs/ai-providers"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#10a37f', textDecoration: 'underline' }}
              >
                https://sokuji.kizuna.ai/docs/ai-providers
              </a>
            </div>
          }
          position="top"
          icon="help"
          maxWidth={350}
        />
      </h3>

      <div className="provider-selection-area">
        {/* A customizable <select> (appearance: base-select): keyboard
            navigation, ARIA and the disabled rule come with the element, and
            the picker floats on the top layer instead of pushing the settings
            below it down the way the old in-flow expander did. Where the
            runtime lacks base-select (extension on Chrome <135), options fall
            back to plain text — rich children would be flattened or invisible
            in the classic OS-drawn popup. */}
        <select
          className="select-dropdown provider-select"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
          disabled={isSessionActive}
          aria-label={t('simpleSettings.provider', 'Provider')}
        >
          {richSelect && (
            // The closed control mirrors the selected option's markup;
            // CSS trims it down (see .provider-select selectedcontent).
            <button type="button"><selectedcontent /></button>
          )}
          {!providerRegistered && (
            // A persisted provider whose registration is gone gets its own
            // disabled option — without it a controlled select with an
            // unmatched value silently displays the first registered provider
            // while the store still holds this one.
            renderProviderOption(provider, true)
          )}
          {availableProviders.map((p) => renderProviderOption(p.id as ProviderType))}
        </select>
        {provider === Provider.LOCAL_NATIVE && <EngineStatusLine />}
      </div>

      {/* API Endpoint Input - Only for OpenAI Compatible */}
      {provider === Provider.OPENAI_COMPATIBLE && (
        <div className="endpoint-input-group">
          <input
            type="text"
            value={openAICompatibleSettings.customEndpoint}
            onChange={(e) => updateOpenAICompatibleSettings({ customEndpoint: e.target.value })}
            placeholder={t('providers.openaiCompatible.customEndpointPlaceholder', 'https://your-api-endpoint.com')}
            className="endpoint-input"
            disabled={isSessionActive}
          />
        </div>
      )}

      {/* API Key Input or Kizuna AI Status or Local Inference (no key needed) */}
      {provider === Provider.LOCAL_NATIVE ? (
        // data-tour sits on the wrapper, not the chip row: the tour's `models`
        // step runs while the sidecar may still be 'starting', and only the
        // wrapper is present in every native state.
        <div className="local-inference-info" data-tour="engine-chips">
          {(nativeStatus === 'starting' || nativeStatus === 'idle') ? (
            <div className="model-info local-native-status is-loading">{t('settings.localNativeStarting', 'Starting the local engine')}</div>
          ) : nativeStatus === 'unavailable' ? (
            <div className="model-info local-native-status is-error">{t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')}</div>
          ) : (
            <div className="model-info">
              {renderChipGroups(
                renderNativeChips, nativeSpeakerResolved, nativeParticipantResolved,
                localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage,
              )}
              {nativeActual ? (
                <div className="memory-estimate">
                  <Cpu size={11} />
                  <span className="memory-estimate__label">{t('engineUi.inUse', 'In use')}</span>
                  {nativeActual.vramMb > 0 && <span>VRAM {formatMemMb(nativeActual.vramMb)}</span>}
                  {nativeActual.ramMb > 0 && <span>RAM {formatMemMb(nativeActual.ramMb)}</span>}
                  {nativeActual.degraded && (
                    <span className="memory-estimate__warn">{t('engineUi.translationOnCpu', 'Translation on CPU — not enough VRAM')}</span>
                  )}
                </div>
              ) : nativeMemoryEstimate && (nativeMemoryEstimate.vramMb > 0 || nativeMemoryEstimate.ramMb > 0) && (
                <div className="memory-estimate">
                  <Cpu size={11} />
                  <span className="memory-estimate__label">{t('engineUi.estimated', 'Estimated')}</span>
                  {nativeMemoryEstimate.vramMb > 0 && <span>VRAM ~{formatMemMb(nativeMemoryEstimate.vramMb)}</span>}
                  {nativeMemoryEstimate.ramMb > 0 && <span>RAM ~{formatMemMb(nativeMemoryEstimate.ramMb)}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      ) : provider === Provider.LOCAL_INFERENCE ? (
        // Same anchor placement as the native branch above, for the same reason.
        <div className="local-inference-info" data-tour="engine-chips">
          <div className="model-info">
            {renderChipGroups(
              renderInferenceChips, speakerResolved, participantResolved,
              localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage,
            )}
            {memoryEstimate && (memoryEstimate.vramMb > 0 || memoryEstimate.ramMb > 0) && (
              <div className="memory-estimate">
                <Cpu size={11} />
                {memoryEstimate.vramMb > 0 && (
                  <span>VRAM ~{memoryEstimate.vramMb >= 1024 ? `${(memoryEstimate.vramMb / 1024).toFixed(1)} GB` : `${memoryEstimate.vramMb} MB`}</span>
                )}
                {memoryEstimate.ramMb > 0 && (
                  <span>RAM ~{memoryEstimate.ramMb >= 1024 ? `${(memoryEstimate.ramMb / 1024).toFixed(1)} GB` : `${memoryEstimate.ramMb} MB`}</span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (!isKizunaManagedProvider(provider)) ? (
        provider === Provider.VOLCENGINE_AST2 ? (
          // Volcengine AST2 requires both APP ID and Access Token
          <div className="volcengine-st-credentials-group">
            <div className="api-key-input-group">
              <input
                type="text"
                value={volcengineAST2Settings.appId}
                onChange={(e) => updateVolcengineAST2Settings({ appId: e.target.value })}
                placeholder={t('providers.volcengine_ast2.appIdPlaceholder', 'APP ID')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
            </div>
            <div className="api-key-input-group">
              <input
                type="password"
                value={volcengineAST2Settings.accessToken}
                onChange={(e) => updateVolcengineAST2Settings({ accessToken: e.target.value })}
                placeholder={t('providers.volcengine_ast2.accessTokenPlaceholder', 'Access Token')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
              <button
                className="validate-button"
                onClick={handleValidateApiKey}
                disabled={!volcengineAST2Settings.appId || !volcengineAST2Settings.accessToken || isValidating || isSessionActive}
                title={t('simpleSettings.validate')}
              >
                {isValidating ? (
                  <span className="spinner" />
                ) : isApiKeyValid ? (
                  <CheckCircle size={16} />
                ) : (
                  t('simpleSettings.validate')
                )}
              </button>
            </div>
          </div>
        ) : provider === Provider.VOLCENGINE_ST ? (
          // Volcengine ST requires both Access Key ID and Secret Access Key
          <div className="volcengine-st-credentials-group">
            <div className="api-key-input-group">
              <input
                type="text"
                value={volcengineSTSettings.accessKeyId}
                onChange={(e) => updateVolcengineSTSettings({ accessKeyId: e.target.value })}
                placeholder={t('providers.volcengine_st.accessKeyIdPlaceholder', 'Access Key ID')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
            </div>
            <div className="api-key-input-group">
              <input
                type="password"
                value={volcengineSTSettings.secretAccessKey}
                onChange={(e) => updateVolcengineSTSettings({ secretAccessKey: e.target.value })}
                placeholder={t('providers.volcengine_st.secretAccessKeyPlaceholder', 'Secret Access Key')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
              <button
                className="validate-button"
                onClick={handleValidateApiKey}
                disabled={!volcengineSTSettings.accessKeyId || !volcengineSTSettings.secretAccessKey || isValidating || isSessionActive}
                title={t('simpleSettings.validate')}
              >
                {isValidating ? (
                  <span className="spinner" />
                ) : isApiKeyValid ? (
                  <CheckCircle size={16} />
                ) : (
                  t('simpleSettings.validate')
                )}
              </button>
            </div>
          </div>
        ) : provider === Provider.ZOOM_AI ? (
          // Zoom AI requires both an API Key and an API Secret (Build Platform)
          <div className="volcengine-st-credentials-group">
            <div className="api-key-input-group">
              <input
                type="text"
                value={zoomAISettings.apiKey}
                onChange={(e) => updateZoomAISettings({ apiKey: e.target.value })}
                placeholder={t('providers.zoom_ai.apiKeyPlaceholder', 'API Key')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
            </div>
            <div className="api-key-input-group">
              <input
                type="password"
                value={zoomAISettings.apiSecret}
                onChange={(e) => updateZoomAISettings({ apiSecret: e.target.value })}
                placeholder={t('providers.zoom_ai.apiSecretPlaceholder', 'API Secret')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
              <button
                className="validate-button"
                onClick={handleValidateApiKey}
                disabled={!zoomAISettings.apiKey || !zoomAISettings.apiSecret || isValidating || isSessionActive}
                title={t('simpleSettings.validate')}
              >
                {isValidating ? <span className="spinner" /> : isApiKeyValid ? <CheckCircle size={16} /> : t('simpleSettings.validate')}
              </button>
            </div>
          </div>
        ) : provider === Provider.PALABRA_AI ? (
          // PalabraAI has two auth systems: platform API key (Bearer) or the legacy
          // app Client ID/Secret pair. All three values persist; the toggle only
          // selects which are used.
          <div className="palabraai-credentials-group">
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-option ${palabraAISettings.authMode === 'platform' ? 'active' : ''}`}
                onClick={() => updatePalabraAISettings({ authMode: 'platform' })}
                disabled={isSessionActive}
              >
                {t('providers.palabraai.authModePlatform', 'Platform API Key')}
              </button>
              <button
                type="button"
                className={`segmented-option ${palabraAISettings.authMode === 'app' ? 'active' : ''}`}
                onClick={() => updatePalabraAISettings({ authMode: 'app' })}
                disabled={isSessionActive}
              >
                {t('providers.palabraai.authModeApp', 'App Client ID/Secret')}
              </button>
            </div>
            {palabraAISettings.authMode === 'platform' ? (
              <div className="api-key-input-group">
                <input
                  type="password"
                  value={palabraAISettings.apiKey}
                  onChange={(e) => updatePalabraAISettings({ apiKey: e.target.value })}
                  placeholder={t('providers.palabraai.apiKeyPlaceholder', 'API Key')}
                  className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                  disabled={isSessionActive}
                />
                <button
                  className="validate-button"
                  onClick={handleValidateApiKey}
                  disabled={!palabraAISettings.apiKey || isValidating || isSessionActive}
                  title={t('simpleSettings.validate')}
                >
                  {isValidating ? <span className="spinner" /> : isApiKeyValid ? <CheckCircle size={16} /> : t('simpleSettings.validate')}
                </button>
              </div>
            ) : (
              <>
                <div className="api-key-input-group">
                  <input
                    type="password"
                    value={palabraAISettings.clientId}
                    onChange={(e) => updatePalabraAISettings({ clientId: e.target.value })}
                    placeholder={t('providers.palabraai.clientIdPlaceholder', 'Client ID')}
                    className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                    disabled={isSessionActive}
                  />
                </div>
                <div className="api-key-input-group">
                  <input
                    type="password"
                    value={palabraAISettings.clientSecret}
                    onChange={(e) => updatePalabraAISettings({ clientSecret: e.target.value })}
                    placeholder={t('providers.palabraai.clientSecretPlaceholder', 'Client Secret')}
                    className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                    disabled={isSessionActive}
                  />
                  <button
                    className="validate-button"
                    onClick={handleValidateApiKey}
                    disabled={!palabraAISettings.clientId || !palabraAISettings.clientSecret || isValidating || isSessionActive}
                    title={t('simpleSettings.validate')}
                  >
                    {isValidating ? (
                      <span className="spinner" />
                    ) : isApiKeyValid ? (
                      <CheckCircle size={16} />
                    ) : (
                      t('simpleSettings.validate')
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          // Standard API key input for other providers
          <div className="api-key-input-group">
            <input
              type="password"
              value={currentApiKey}
              onChange={(e) => updateApiKey(e.target.value)}
              placeholder={t('simpleSettings.apiKeyPlaceholder')}
              className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
              disabled={isSessionActive}
            />
            <button
              className="validate-button"
              onClick={handleValidateApiKey}
              disabled={!currentApiKey || isValidating || isSessionActive}
            >
              {isValidating ? (
                <span className="spinner" />
              ) : isApiKeyValid ? (
                <CheckCircle size={16} />
              ) : (
                t('simpleSettings.validate')
              )}
            </button>
          </div>
        )
      ) : (
        isSignedIn ? (
          isKizunaKeyFetching ? (
            <div className="api-key-info">
              <span className="spinner" />
              <span>{t('simpleSettings.fetchingApiKey', 'Fetching API key from your account...')}</span>
            </div>
          ) : kizunaKeyError ? (
            <div className="api-key-warning">
              <AlertCircle size={16} className="warning-icon" />
              {/* kizunaKeyError is a translation key ('auth.*'), not prose —
                  the store logs the engineering detail and keeps the UI
                  translatable. */}
              <span>{t(kizunaKeyError)}</span>
            </div>
          ) : (
            <div className="api-key-info">
              <CheckCircle size={16} className="success-icon" />
              <span>{t('simpleSettings.autoAuthenticated', 'Automatically authenticated via your account')}</span>
            </div>
          )
        ) : (
          <div className="api-key-warning">
            <AlertCircle size={16} className="warning-icon" />
            <span>
              {/* An entry point rather than a statement: the sentence used to
                  name a restriction with nothing to act on. Clicking opens the
                  title-bar account popover instead of navigating, so the
                  sign-in affordance lives in exactly one place and the click
                  itself shows where the account entry is. */}
              <Trans
                i18nKey="common.signInRequired"
                components={{
                  signInLink: (
                    <button
                      type="button"
                      className="sign-in-link"
                      onClick={() => setAccountPopoverRequested(true)}
                    />
                  ),
                }}
              />
            </span>
          </div>
        )
      )}

      {tutorialUrl && !dismissedTutorials.has(provider) && (
        <div className="tutorial-link">
          <a href={tutorialUrl} onClick={(e) => { e.preventDefault(); openExternalUrl(tutorialUrl); }}>
            <ExternalLink size={12} />
            {t('simpleSettings.setupGuide', 'Setup guide')}
          </a>
          <button className="tutorial-dismiss" onClick={() => dismissTutorial(provider)} title={t('common.dismiss', 'Dismiss')}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Local providers' "models missing" state is narrated ONCE, by
          LanguageSection's resolver-backed warning with per-stage download
          links (2026-08-23 warning-dedup decision) — repeating it here as a
          validation error was the same sentence twice on one screen. The
          validation STATE itself is untouched; only the duplicate copy goes. */}
      {validationMessage
        && !((provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE) && !isApiKeyValid) && (
        <div className={`validation-message ${isApiKeyValid ? 'success' : 'error'}`}>
          {validationMessage}
        </div>
      )}
    </div>
  );
};

export default ProviderSection;
