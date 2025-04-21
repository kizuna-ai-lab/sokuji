import React, { useState } from 'react';
import './TokenGenerator.scss';
import { useLog } from '../../contexts/LogContext';
import { useSettings } from '../../contexts/SettingsContext';

interface TokenResponse {
  success: boolean;
  data?: {
    token?: string;
    expires_at?: number;
    client_secret?: {
      value: string;
      expires_at: number;
    };
    [key: string]: any;
  };
  error?: string;
}

const TokenGenerator: React.FC = () => {
  const { settings } = useSettings();
  const { addLog } = useLog();
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const generateToken = async () => {
    setIsGenerating(true);
    setError('');
    
    addLog(`Generating token for model: ${settings.model}, voice: ${settings.voice}`, 'info');

    try {
      // Use the OpenAI token generation API from Electron preload
      const response: TokenResponse = await window.electron.openai.generateToken({
        model: settings.model,
        voice: settings.voice,
        turnDetectionMode: settings.turnDetectionMode,
        threshold: settings.threshold,
        prefixPadding: settings.prefixPadding,
        silenceDuration: settings.silenceDuration,
        semanticEagerness: settings.semanticEagerness,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        transcriptModel: settings.transcriptModel,
        noiseReduction: settings.noiseReduction,
        systemInstructions: settings.systemInstructions
      });

      console.log('Token response:', response);
      if (response.success && response.data) {
        // Extract the token from client_secret.value
        if (response.data.client_secret?.value) {
          const token = response.data.client_secret.value;
          let expiryInfo = '';
          
          // Use client_secret.expires_at for expiration time
          if (response.data.client_secret.expires_at) {
            const expiryTimestamp = response.data.client_secret.expires_at;
            const expiryDate = new Date(expiryTimestamp * 1000); // Convert from Unix timestamp
            expiryInfo = ` (expires: ${expiryDate.toLocaleString()})`;
          }
          
          // Log the token to the LogsPanel
          addLog(`Token generated successfully${expiryInfo}`, 'success');
          addLog(`Token: ${token}`, 'token');
        } else if (response.data.token) {
          // Fallback to token if client_secret is not available
          const token = response.data.token;
          let expiryInfo = '';
          
          if (response.data.expires_at) {
            const expiryTimestamp = response.data.expires_at;
            // Only set if it's a valid timestamp (not 0)
            if (expiryTimestamp > 0) {
              const expiryDate = new Date(expiryTimestamp * 1000);
              expiryInfo = ` (expires: ${expiryDate.toLocaleString()})`;
            }
          }
          
          // Log the token to the LogsPanel
          addLog(`Token generated successfully${expiryInfo}`, 'success');
          addLog(`Token: ${token}`, 'token');
        } else {
          setError('Token not found in response');
          addLog('Error: Token not found in response', 'error');
        }
      } else {
        const errorMessage = response.error || 'Failed to generate token';
        setError(errorMessage);
        addLog(`Error: ${errorMessage}`, 'error');
      }
    } catch (err) {
      console.error('Error generating token:', err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(errorMessage);
      addLog(`Error generating token: ${errorMessage}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="token-generator">
      <div className="token-controls">
        <button 
          className="generate-button"
          onClick={generateToken}
          disabled={isGenerating}
        >
          {isGenerating ? 'Generating...' : 'Generate Token'}
        </button>
      </div>
      
      {error && (
        <div className="token-error">
          Error: {error}
        </div>
      )}
    </div>
  );
};

export default TokenGenerator;
