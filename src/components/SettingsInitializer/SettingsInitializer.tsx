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
  useLocalInferenceSettings
} from '../../stores/settingsStore';
import { useModelStatuses, useModelInitialized, useModelStore } from '../../stores/modelStore';
import { useAuth } from '../../lib/auth/hooks';
import { Provider } from '../../types/Provider';

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

  // Get all provider settings to monitor credential changes
  const openAISettings = useOpenAISettings();
  const geminiSettings = useGeminiSettings();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const palabraAISettings = usePalabraAISettings();
  const volcengineSTSettings = useVolcengineSTSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();

  // Monitor model download statuses and local inference settings for LOCAL_INFERENCE
  const modelStatuses = useModelStatuses();
  const modelInitialized = useModelInitialized();
  const localInferenceSettings = useLocalInferenceSettings();

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
      if (provider === Provider.KIZUNA_AI && isSignedIn && getToken) {
        console.log('[SettingsInitializer] KizunaAI provider selected, ensuring API key...');
        const hasKey = await ensureKizunaApiKey(getToken, isSignedIn);

        if (hasKey && !isValidatingRef.current) {
          isValidatingRef.current = true;
          console.log('[SettingsInitializer] KizunaAI API key obtained, validating...');
          try {
            await validateApiKey(getToken);
          } finally {
            isValidatingRef.current = false;
          }
        }
      }
    };

    handleKizunaAI();
  }, [provider, isSignedIn, getToken, ensureKizunaApiKey, validateApiKey]);

  // ── API providers: validate when provider changes or credentials change ──
  useEffect(() => {
    if (!settingsLoaded) return;
    // Skip LOCAL_INFERENCE (handled by the next effect) and KizunaAI (handled above)
    if (provider === Provider.LOCAL_INFERENCE || provider === Provider.KIZUNA_AI) return;

    prevProviderRef.current = provider;

    // Always call validateApiKey — it handles empty credentials internally
    // (sets isApiKeyValid to null, clears availableModels).
    if (!isValidatingRef.current) {
      isValidatingRef.current = true;
      console.log('[SettingsInitializer] Validating API provider:', provider);
      validateApiKey().finally(() => {
        isValidatingRef.current = false;
      });
    }
  }, [settingsLoaded, provider, openAISettings.apiKey, geminiSettings.apiKey,
      openAICompatibleSettings.apiKey,
      palabraAISettings.clientId, palabraAISettings.clientSecret,
      volcengineSTSettings.accessKeyId, volcengineSTSettings.secretAccessKey,
      volcengineAST2Settings.appId, volcengineAST2Settings.accessToken,
      validateApiKey]);

  // ── LOCAL_INFERENCE: validate when model statuses or language settings change ──
  // validateApiKey() handles everything: model store init, auto-select, readiness check.
  useEffect(() => {
    if (!settingsLoaded) {
      console.debug('[SettingsInitializer] LOCAL_INFERENCE effect: skipped (settings not loaded)');
      return;
    }
    if (provider !== Provider.LOCAL_INFERENCE) return;
    if (!modelInitialized) {
      console.debug('[SettingsInitializer] LOCAL_INFERENCE effect: skipped (model store not initialized)');
      return;
    }

    console.log('[SettingsInitializer] LOCAL_INFERENCE effect triggered:', {
      sourceLanguage: localInferenceSettings.sourceLanguage,
      targetLanguage: localInferenceSettings.targetLanguage,
      asrModel: localInferenceSettings.asrModel,
      translationModel: localInferenceSettings.translationModel,
      ttsModel: localInferenceSettings.ttsModel,
      isValidating: isValidatingRef.current,
    });

    // Track provider ref so the API-provider effect above doesn't re-fire
    prevProviderRef.current = provider;

    // validateApiKey for LOCAL_INFERENCE is effectively synchronous (no network call),
    // so no flickering despite being async. It handles autoSelectModels + isProviderReady.
    if (!isValidatingRef.current) {
      isValidatingRef.current = true;
      console.log('[SettingsInitializer] LOCAL_INFERENCE: starting validateApiKey');
      validateApiKey()
        .then((result) => {
          console.log('[SettingsInitializer] LOCAL_INFERENCE: validateApiKey result:', result);
        })
        .catch((error) => {
          console.error('[SettingsInitializer] Failed to validate LOCAL_INFERENCE provider:', error);
        })
        .finally(() => {
          isValidatingRef.current = false;
          console.debug('[SettingsInitializer] LOCAL_INFERENCE: isValidatingRef reset to false');
        });
    } else {
      console.warn('[SettingsInitializer] LOCAL_INFERENCE effect: SKIPPED — already validating');
    }
  }, [settingsLoaded, provider, modelInitialized, modelStatuses, localInferenceSettings,
      validateApiKey]);

  // This component doesn't render anything
  return null;
}
