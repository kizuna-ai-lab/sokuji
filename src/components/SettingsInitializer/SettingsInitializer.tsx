import { useEffect, useRef } from 'react';
import {
  useProvider,
  useValidateApiKey,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useVolcengineSTSettings,
  useVolcengineAST2Settings,
  useSettingsLoaded
} from '../../stores/settingsStore';
import { Provider } from '../../types/Provider';

/**
 * Component that monitors settings and ensures API keys are validated when needed
 */
export function SettingsInitializer() {
  const provider = useProvider();
  const validateApiKey = useValidateApiKey();
  const settingsLoaded = useSettingsLoaded();
  
  // Track previous provider to detect changes (null initially to trigger validation on mount)
  const prevProviderRef = useRef<typeof provider | null>(null);
  const isValidatingRef = useRef(false);
  
  // Get all provider settings to monitor API key changes
  const openAISettings = useOpenAISettings();
  const geminiSettings = useGeminiSettings();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const palabraAISettings = usePalabraAISettings();
  const volcengineSTSettings = useVolcengineSTSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();

  // Auto-validate when provider changes
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
      
      if (!isValidatingRef.current) {
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
          case Provider.VOLCENGINE_ST:
            hasApiKey = !!volcengineSTSettings.accessKeyId && !!volcengineSTSettings.secretAccessKey;
            break;
          case Provider.VOLCENGINE_AST2:
            hasApiKey = !!volcengineAST2Settings.appId && !!volcengineAST2Settings.accessToken;
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
      palabraAISettings.clientId, palabraAISettings.clientSecret, volcengineSTSettings.accessKeyId,
      volcengineSTSettings.secretAccessKey, volcengineAST2Settings.appId, volcengineAST2Settings.accessToken,
      validateApiKey]);

  // This component doesn't render anything
  return null;
}