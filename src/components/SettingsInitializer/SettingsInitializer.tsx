import { useEffect, useRef } from 'react';
import {
  useProvider,
  useEnsureKizunaApiKey,
  useValidateApiKey,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useVolcengineSTSettings,
  useVolcengineAST2Settings,
  useSettingsLoaded,
  useLocalInferenceSettings,
  useLocalNativeSettings,
  useTextOnly,
} from '../../stores/settingsStore';
import useSettingsStore from '../../stores/settingsStore';
import { useMode } from '../../stores/audioStore';
import { useModelStatuses, useModelInitialized, useModelStore } from '../../stores/modelStore';
import { useAuth } from '../../lib/auth/hooks';
import { Provider, isKizunaManagedProvider } from '../../types/Provider';
import { getEdgeTtsVoices, filterVoicesByLanguage } from '../../lib/edge-tts/voiceList';

/**
 * SettingsInitializer — watches for settings changes and triggers session readiness
 * validation via validateApiKey(). All Start-button state (isApiKeyValid, availableModels,
 * isValidating) is written exclusively inside settingsStore.validateApiKey().
 * This component only decides WHEN to call it.
 */
export function SettingsInitializer() {
  const provider = useProvider();
  const ensureKizunaApiKey = useEnsureKizunaApiKey();
  const validateApiKey = useValidateApiKey();
  const settingsLoaded = useSettingsLoaded();
  const { isSignedIn, getToken } = useAuth();

  // Track previous provider to detect changes (null initially to trigger validation on mount)
  const prevProviderRef = useRef<typeof provider | null>(null);
  const isValidatingRef = useRef(false);
  // Set when a credential/provider change lands mid-validation; consumed by
  // the API-provider effect below to run one follow-up validation.
  const pendingRevalidateRef = useRef(false);

  // Get all provider settings to monitor credential changes
  const openAISettings = useOpenAISettings();
  const geminiSettings = useGeminiSettings();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const palabraAISettings = usePalabraAISettings();
  const volcengineSTSettings = useVolcengineSTSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();
  // Only the REGION, not the keys. Soniox's keys are deliberately absent from
  // the validation effect below (they always were — the explicit Validate
  // button covers them), but the region is different in kind: one slice now
  // holds three independent credentials while `isApiKeyValid` is a single
  // verdict, so switching region silently leaves the verdict describing a key
  // that is no longer the active one.
  const sonioxRegion = useSettingsStore((state) => state.soniox.region);

  // Monitor model download statuses and local inference settings for LOCAL_INFERENCE
  const modelStatuses = useModelStatuses();
  const modelInitialized = useModelInitialized();
  const localInferenceSettings = useLocalInferenceSettings();
  const localNativeSettings = useLocalNativeSettings();

  // Native readiness asks whether the session needs a TTS model, and that
  // answer is `effectiveTextOnly(speaker leg in scope, the toggle)` — so BOTH
  // of these are readiness inputs, and the native effect below is the only
  // thing that re-runs validateApiKey for LOCAL_NATIVE (the generic credential
  // effect skips it). Untracked, either one leaves the standing verdict
  // describing a session shape the user has already left: fail readiness in
  // Speaker for a missing voice, switch to Others, and Start stays disabled
  // forever even though a participant-only session never loads a voice.
  const audioMode = useMode();
  const textOnly = useTextOnly();

  // ── Ensure model store is initialized when LOCAL_INFERENCE is selected ──
  useEffect(() => {
    if (!settingsLoaded) return;
    if (provider !== Provider.LOCAL_INFERENCE) return;
    if (modelInitialized) return;
    useModelStore.getState().initialize();
  }, [settingsLoaded, provider, modelInitialized]);

  // ── KizunaAI: auto-fetch API key when user logs in or provider changes ──
  useEffect(() => {
    const handleKizunaAI = async () => {
      if (!isKizunaManagedProvider(provider)) return;

      if (isSignedIn && getToken) {
        console.log('[SettingsInitializer] KizunaAI provider selected, ensuring API key...');
        const hasKey = await ensureKizunaApiKey(getToken, isSignedIn);

        if (hasKey && !isValidatingRef.current) {
          isValidatingRef.current = true;
          console.log('[SettingsInitializer] KizunaAI API key obtained, validating...');
          try {
            await validateApiKey(getToken, isSignedIn);
          } finally {
            isValidatingRef.current = false;
          }
        }
      } else if (!isValidatingRef.current) {
        // Kizuna twin selected but auth is missing (signed out or hook not ready).
        // Re-run validation so the store clears isApiKeyValid/availableModels;
        // otherwise a stale signed-in validity would keep Start enabled until a
        // later connect attempt fails with an empty session token.
        //
        // `isSignedIn` has to travel with the token getter: getToken is always
        // a function here (it just resolves to null when signed out), so the
        // store cannot infer this branch's meaning from the argument alone —
        // and this branch exists precisely FOR the signed-out case.
        isValidatingRef.current = true;
        console.log('[SettingsInitializer] KizunaAI provider selected without auth, clearing validity...');
        try {
          await validateApiKey(getToken, isSignedIn);
        } finally {
          isValidatingRef.current = false;
        }
      }
    };

    handleKizunaAI();
  }, [provider, isSignedIn, getToken, ensureKizunaApiKey, validateApiKey]);

  // ── API providers: validate when provider changes or credentials change ──
  useEffect(() => {
    if (!settingsLoaded) return;
    // Skip LOCAL_INFERENCE and LOCAL_NATIVE (each handled by its own reactive
    // effect below) and Kizuna-managed providers (handled above)
    if (provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE || isKizunaManagedProvider(provider)) return;

    prevProviderRef.current = provider;

    // Always call validateApiKey — it handles empty credentials internally
    // (sets isApiKeyValid to null, clears availableModels).
    // Changes that arrive while a validation is in flight queue exactly one
    // rerun: validateApiKey reads the latest store state at call time, so the
    // follow-up run covers the final values instead of dropping them.
    const runValidation = () => {
      isValidatingRef.current = true;
      validateApiKey().finally(() => {
        isValidatingRef.current = false;
        if (pendingRevalidateRef.current) {
          pendingRevalidateRef.current = false;
          runValidation();
        }
      });
    };
    if (isValidatingRef.current) {
      pendingRevalidateRef.current = true;
    } else {
      console.log('[SettingsInitializer] Validating API provider:', provider);
      runValidation();
    }
  }, [settingsLoaded, provider, openAISettings.apiKey, geminiSettings.apiKey,
      openAICompatibleSettings.apiKey,
      palabraAISettings.authMode, palabraAISettings.apiKey,
      palabraAISettings.clientId, palabraAISettings.clientSecret,
      volcengineSTSettings.accessKeyId, volcengineSTSettings.secretAccessKey,
      volcengineAST2Settings.appId, volcengineAST2Settings.accessToken,
      // Switching region swaps WHICH key is active, so the standing verdict is
      // about a different credential and must be re-derived. Without this,
      // Start stays enabled on a region whose key is empty (and fails at
      // connect), or stays disabled on a region whose key is already good.
      sonioxRegion,
      validateApiKey]);

  // ── Edge TTS: auto-select voice when target language changes ───────────
  // The UI's voice picker effect (in ProviderSpecificSettings) only fires
  // while the settings screen is mounted, so changing target language from
  // elsewhere (e.g. LanguageSection) used to leave a stale voice in the
  // store. This effect lives in SettingsInitializer (always mounted) and
  // picks the first voice for the current language whenever the stored
  // voice doesn't match — ensuring the session config and UI stay in sync.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (provider !== Provider.LOCAL_INFERENCE) return;
    const resolvedTts = useModelStore.getState().resolve(
      localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage,
      localInferenceSettings.selections,
    ).tts?.modelId;
    if (resolvedTts !== 'edge-tts') return;

    let cancelled = false;
    getEdgeTtsVoices()
      .then(voices => {
        if (cancelled) return;
        const candidates = filterVoicesByLanguage(voices, localInferenceSettings.targetLanguage);
        if (candidates.length === 0) return;
        const current = localInferenceSettings.edgeTtsVoice;
        const isValid = candidates.some(v => v.ShortName === current);
        if (!isValid) {
          useSettingsStore.getState().updateLocalInference({ edgeTtsVoice: candidates[0].ShortName });
        }
      })
      .catch(err => {
        console.warn('[SettingsInitializer] Failed to auto-select Edge TTS voice:', err);
      });

    return () => { cancelled = true; };
  }, [settingsLoaded, provider, localInferenceSettings.sourceLanguage, localInferenceSettings.selections,
      localInferenceSettings.targetLanguage, localInferenceSettings.edgeTtsVoice, modelStatuses]);

  // ── LOCAL_INFERENCE: validate when model statuses or language settings change ──
  // validateApiKey() handles everything: model store init, auto-select, readiness check.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (provider !== Provider.LOCAL_INFERENCE) return;
    // Wait until model store has scanned IndexedDB
    if (!modelInitialized) return;

    // Track provider ref so the API-provider effect above doesn't re-fire
    prevProviderRef.current = provider;

    // validateApiKey for LOCAL_INFERENCE is effectively synchronous (no network call),
    // so no flickering despite being async. It handles autoSelectModels +
    // ensureSelectionReady's resolver gate.
    if (!isValidatingRef.current) {
      isValidatingRef.current = true;
      validateApiKey()
        .catch((error) => {
          console.error('[SettingsInitializer] Failed to validate LOCAL_INFERENCE provider:', error);
        })
        .finally(() => {
          isValidatingRef.current = false;
        });
    }
  }, [settingsLoaded, provider, modelInitialized, modelStatuses, localInferenceSettings,
      validateApiKey]);

  // ── LOCAL_NATIVE: warm sidecar then validate when language pair or models change ──
  // The native readiness gate (validateApiKey) is the single authority for the
  // Start button, but native settings changes (e.g. reversing the language pair,
  // which can leave the translation model incompatible) don't otherwise re-run
  // it — unlike LOCAL_INFERENCE. Without this, the button keeps a stale enabled
  // state after a swap that has no usable translation model. Scoped to the
  // readiness-relevant fields so device/voice/VAD tweaks don't re-hit the sidecar.
  // ensureCatalog() is called first so the sidecar leaves `idle` on provider
  // selection / settings load without waiting for a Start click.
  useEffect(() => {
    if (!settingsLoaded || provider !== Provider.LOCAL_NATIVE) return;
    prevProviderRef.current = provider;
    let cancelled = false;
    (async () => {
      const { useNativeModelStore } = await import('../../stores/nativeModelStore');
      await useNativeModelStore.getState().ensureCatalog();
      if (!cancelled) await validateApiKey();
    })().catch((error) => {
      console.error('[SettingsInitializer] Failed to warm/validate LOCAL_NATIVE provider:', error);
    });
    return () => { cancelled = true; };
  }, [settingsLoaded, provider,
      localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage,
      localNativeSettings.selections,
      // The two inputs to the effective text-only answer — see their
      // declaration above for why a stale verdict is unrecoverable here.
      audioMode, textOnly,
      validateApiKey]);

  // This component doesn't render anything
  return null;
}
