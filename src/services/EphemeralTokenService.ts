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
   * @param model - The realtime model to use (e.g., 'gpt-4o-realtime-preview')
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
}
