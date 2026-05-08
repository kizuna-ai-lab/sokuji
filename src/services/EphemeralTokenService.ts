/**
 * EphemeralTokenService
 *
 * Handles fetching and caching ephemeral tokens for OpenAI WebRTC connections.
 * Ephemeral tokens are short-lived credentials that allow browser-based WebRTC
 * connections to the OpenAI Realtime API.
 */

interface EphemeralTokenResponse {
  client_secret: {
    value: string;
    expires_at: number; // Unix timestamp
  };
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

// Cache buffer - refresh token 30 seconds before expiration
const CACHE_BUFFER_MS = 30 * 1000;

// Token cache keyed by model+voice
const tokenCache = new Map<string, CachedToken>();

/**
 * Service for managing ephemeral tokens for OpenAI WebRTC connections
 */
export class EphemeralTokenService {
  private static readonly OPENAI_API_HOST = 'https://api.openai.com';

  /**
   * Get an ephemeral token for WebRTC connection
   * Uses caching to avoid unnecessary API calls
   *
   * @param apiKey - The user's OpenAI API key
   * @param model - The realtime model to use (e.g., 'gpt-realtime-mini')
   * @param voice - The voice to use (e.g., 'alloy')
   * @param apiHost - Optional custom API host (for OpenAI Compatible)
   * @returns The ephemeral token string
   */
  static async getToken(
    apiKey: string,
    model: string,
    voice: string,
    apiHost?: string
  ): Promise<string> {
    const cacheKey = `${apiHost || this.OPENAI_API_HOST}:${model}:${voice}`;
    const cached = tokenCache.get(cacheKey);

    // Check if cached token is still valid (with buffer)
    if (cached && Date.now() < cached.expiresAt - CACHE_BUFFER_MS) {
      console.debug('[EphemeralTokenService] Using cached token');
      return cached.value;
    }

    // Fetch new token
    console.debug('[EphemeralTokenService] Fetching new ephemeral token');
    const token = await this.fetchToken(apiKey, model, voice, apiHost);
    return token;
  }

  /**
   * Fetch a new ephemeral token from OpenAI API
   */
  private static async fetchToken(
    apiKey: string,
    model: string,
    voice: string,
    apiHost?: string
  ): Promise<string> {
    const host = apiHost || this.OPENAI_API_HOST;
    const endpoint = `${host.replace(/\/$/, '')}/v1/realtime/sessions`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          voice
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        throw new Error(`Failed to get ephemeral token: ${errorMessage}`);
      }

      const data: EphemeralTokenResponse = await response.json();

      if (!data.client_secret?.value) {
        throw new Error('Invalid token response: missing client_secret');
      }

      // Cache the token
      const cacheKey = `${host}:${model}:${voice}`;
      tokenCache.set(cacheKey, {
        value: data.client_secret.value,
        expiresAt: data.client_secret.expires_at * 1000 // Convert to milliseconds
      });

      console.debug('[EphemeralTokenService] Obtained new ephemeral token, expires at:',
        new Date(data.client_secret.expires_at * 1000).toISOString());

      return data.client_secret.value;
    } catch (error) {
      console.error('[EphemeralTokenService] Error fetching ephemeral token:', error);
      throw error;
    }
  }

  /**
   * Clear cached token for a specific model/voice combination
   */
  static clearCache(model?: string, voice?: string, apiHost?: string): void {
    if (model && voice) {
      const host = apiHost || this.OPENAI_API_HOST;
      const cacheKey = `${host}:${model}:${voice}`;
      tokenCache.delete(cacheKey);
      console.debug('[EphemeralTokenService] Cleared cache for:', cacheKey);
    } else {
      tokenCache.clear();
      console.debug('[EphemeralTokenService] Cleared all cached tokens');
    }
  }

  /**
   * Check if a cached token exists and is valid
   */
  static hasCachedToken(model: string, voice: string, apiHost?: string): boolean {
    const host = apiHost || this.OPENAI_API_HOST;
    const cacheKey = `${host}:${model}:${voice}`;
    const cached = tokenCache.get(cacheKey);
    return cached !== undefined && Date.now() < cached.expiresAt - CACHE_BUFFER_MS;
  }

  /**
   * Mint a short-lived client secret for a translate WebRTC session.
   * The secret is used as the bearer for the SDP exchange at
   * /v1/realtime/translations/calls. Mirrors the existing getToken flow
   * but targets translate's dedicated client_secrets endpoint.
   *
   * @param apiKey User's OpenAI API key
   * @param config Session config to embed in the mint request
   * @param apiHost Optional override (defaults to api.openai.com)
   * @returns The client_secret string
   * @throws Error with the API's error message on non-2xx response
   */
  static async mintTranslationClientSecret(
    apiKey: string,
    config: {
      targetLanguage: string;
      transcriptModel?: string;
      noiseReductionType?: 'near_field' | 'far_field';
    },
    apiHost?: string
  ): Promise<string> {
    const host = (apiHost || this.OPENAI_API_HOST).replace(/\/$/, '');
    const url = `${host}/v1/realtime/translations/client_secrets`;

    interface AudioInput {
      transcription?: { model: string };
      noise_reduction?: { type: 'near_field' | 'far_field' };
    }
    interface SessionBody {
      session: {
        model: string;
        audio: {
          input?: AudioInput;
          output: { language: string };
        };
      };
    }

    const audioInput: AudioInput = {};
    if (config.transcriptModel) {
      audioInput.transcription = { model: config.transcriptModel };
    }
    if (config.noiseReductionType) {
      audioInput.noise_reduction = { type: config.noiseReductionType };
    }

    const body: SessionBody = {
      session: {
        model: 'gpt-realtime-translate',
        audio: {
          output: { language: config.targetLanguage },
        },
      },
    };
    if (Object.keys(audioInput).length > 0) {
      body.session.audio.input = audioInput;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.error?.message || `Failed to mint translation client secret: ${response.status}`;
        throw new Error(message);
      }

      const data = await response.json();
      // Real response shape from /v1/realtime/translations/client_secrets is
      // FLAT — `{ value: 'ek_...', expires_at: ..., session: {...} }` —
      // unlike the regular /v1/realtime/sessions endpoint which nests
      // under `client_secret`. Try the flat shape first (current API),
      // then fall back to the nested shape (legacy / hypothetical change).
      const flatValue = typeof data.value === 'string' ? data.value : undefined;
      const nestedValue = typeof data.client_secret === 'string'
        ? data.client_secret
        : data.client_secret?.value;
      const secret = flatValue ?? nestedValue;
      if (!secret) {
        console.error('[Sokuji] [EphemeralTokenService] Unexpected client_secret response shape:', data);
        throw new Error('Translation client_secret missing from response');
      }
      return secret;
    } catch (error) {
      console.error('[Sokuji] [EphemeralTokenService] Error minting translation client secret:', error);
      throw error;
    }
  }
}
