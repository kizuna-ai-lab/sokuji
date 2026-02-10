import { useEffect, useRef } from 'react';
import {
  useProvider,
  useEnsureKizunaApiKey,
  useValidateApiKey,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useVolcengineSettings,
  useSettingsLoaded
} from '../../stores/settingsStore';
import { useAuth } from '../../lib/auth/hooks';
import { Provider } from '../../types/Provider';

/**
 * Component that monitors settings and ensures API keys are validated when needed
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
  
  // Get all provider settings to monitor API key changes
  const openAISettings = useOpenAISettings();
  const geminiSettings = useGeminiSettings();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const palabraAISettings = usePalabraAISettings();
  const volcengineSettings = useVolcengineSettings();

  // Auto-fetch and validate KizunaAI API key when user logs in or provider changes
  useEffect(() => {
    const handleKizunaAI = async () => {
      if (provider === Provider.KIZUNA_AI && isSignedIn && getToken) {
        console.log('[SettingsInitializer] KizunaAI provider selected, ensuring API key...');
        const hasKey = await ensureKizunaApiKey(getToken, isSignedIn);
        
        // If we successfully got the key, validate it
        if (hasKey && !isValidatingRef.current) {
          isValidatingRef.current = true;
          console.log('[SettingsInitializer] KizunaAI API key obtained, validating...');
          setTimeout(async () => {
            await validateApiKey(getToken);
            isValidatingRef.current = false;
          }, 100);
        }
      }
    };
    
    handleKizunaAI();
  }, [provider, isSignedIn, getToken, ensureKizunaApiKey, validateApiKey]);
  
  // Auto-validate when provider changes (for non-KizunaAI providers)
  useEffect(() => {
    // Only proceed if settings have been loaded
    if (!settingsLoaded) {
      console.log('[SettingsInitializer] Settings not loaded yet, skipping validation');
      return;
    }
    
    // Check if provider actually changed
    if (prevProviderRef.current !== provider) {
      console.log('[SettingsInitializer] Provider changed from', prevProviderRef.current, 'to', provider);
      prevProviderRef.current = provider;
      
      // For non-KizunaAI providers, validate if they have an API key
      if (provider !== Provider.KIZUNA_AI && !isValidatingRef.current) {
        let hasApiKey = false;

        switch (provider) {
          case Provider.OPENAI:
            hasApiKey = !!openAISettings.apiKey;
            break;
          case Provider.GEMINI:
            hasApiKey = !!geminiSettings.apiKey;
            break;
          case Provider.OPENAI_COMPATIBLE:
            hasApiKey = !!openAICompatibleSettings.apiKey;
            break;
          case Provider.PALABRA_AI:
            hasApiKey = !!palabraAISettings.clientId && !!palabraAISettings.clientSecret;
            break;
          case Provider.VOLCENGINE:
            hasApiKey = !!volcengineSettings.accessKeyId && !!volcengineSettings.secretAccessKey;
            break;
        }
        
        if (hasApiKey) {
          isValidatingRef.current = true;
          console.log('[SettingsInitializer] Provider has API key, auto-validating...');
          setTimeout(async () => {
            await validateApiKey();
            isValidatingRef.current = false;
          }, 100);
        }
      }
    }
  }, [settingsLoaded, provider, openAISettings.apiKey, geminiSettings.apiKey, openAICompatibleSettings.apiKey,
      palabraAISettings.clientId, palabraAISettings.clientSecret, volcengineSettings.accessKeyId,
      volcengineSettings.secretAccessKey, validateApiKey]);

  // This component doesn't render anything
  return null;
}