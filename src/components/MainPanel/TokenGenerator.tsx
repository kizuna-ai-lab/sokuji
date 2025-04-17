import React, { useState } from 'react';
import './TokenGenerator.scss';

interface TokenGeneratorProps {
  voice: string;
  model?: string;
}

interface TokenResponse {
  success: boolean;
  data?: {
    token: string;
    expires_at: string;
    [key: string]: any;
  };
  error?: string;
}

const TokenGenerator: React.FC<TokenGeneratorProps> = ({ voice, model }) => {
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [token, setToken] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);

  const generateToken = async () => {
    setIsGenerating(true);
    setError('');
    setToken('');
    setExpiresAt('');

    try {
      // Use the OpenAI token generation API from Electron preload
      const response: TokenResponse = await window.electron.openai.generateToken({
        model: model || 'gpt-4o-realtime-preview',
        voice
      });

      if (response.success && response.data) {
        setToken(response.data.token);
        setExpiresAt(response.data.expires_at);
      } else {
        setError(response.error || 'Failed to generate token');
      }
    } catch (err) {
      console.error('Error generating token:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsGenerating(false);
    }
  };

  const formatExpiryTime = (expiryString: string) => {
    if (!expiryString) return '';
    
    try {
      const expiryDate = new Date(expiryString);
      return expiryDate.toLocaleString();
    } catch (err) {
      return expiryString;
    }
  };

  const copyToClipboard = () => {
    if (token) {
      navigator.clipboard.writeText(token)
        .then(() => {
          // Show a temporary "Copied!" message
          const tokenElement = document.getElementById('token-display');
          if (tokenElement) {
            const originalText = tokenElement.innerText;
            tokenElement.innerText = 'Copied!';
            setTimeout(() => {
              tokenElement.innerText = originalText;
            }, 1500);
          }
        })
        .catch(err => {
          console.error('Failed to copy token:', err);
        });
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
        
        {token && (
          <button 
            className="copy-button"
            onClick={copyToClipboard}
          >
            Copy Token
          </button>
        )}
        
        {token && (
          <button 
            className="toggle-button"
            onClick={() => setShowToken(!showToken)}
          >
            {showToken ? 'Hide Token' : 'Show Token'}
          </button>
        )}
      </div>
      
      {error && (
        <div className="token-error">
          Error: {error}
        </div>
      )}
      
      {token && (
        <div className="token-info">
          <div className="token-display" id="token-display">
            {showToken ? token : '••••••••••••••••••••••••••••••••'}
          </div>
          {expiresAt && (
            <div className="token-expiry">
              Expires at: {formatExpiryTime(expiresAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TokenGenerator;
