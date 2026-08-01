import useLogStore from '../stores/logStore';

/**
 * EphemeralTokenService
 *
 * Mints ephemeral tokens for OpenAI WebRTC connections. Ephemeral tokens are
 * short-lived credentials that allow browser-based WebRTC connections to the
 * OpenAI Realtime API.
 *
 * GA client secrets are single-use: establishing a call consumes the secret,
 * and reusing it fails with `ephemeral_token_already_used`. Tokens must
 * therefore be minted fresh for every connection attempt — never cached.
 */

interface EphemeralTokenResponse {
  value?: string;
  expires_at?: number;
  client_secret?: string | {
    value: string;
    expires_at: number; // Unix timestamp
  };
}

/**
 * Service for managing ephemeral tokens for OpenAI WebRTC connections
 */
export class EphemeralTokenService {
  private static readonly OPENAI_API_HOST = 'https://api.openai.com';
  private static readonly CLIENT_SECRET_REQUEST_TIMEOUT_MS = 15000;

  /**
   * Mint a fresh ephemeral token for a WebRTC connection.
   * Always hits the API: GA client secrets are single-use.
   *
   * @param apiKey - The user's OpenAI API key
   * @param model - The realtime model to use (e.g., 'gpt-realtime-2.1-mini')
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
    console.debug('[EphemeralTokenService] Minting new ephemeral token');
    return this.fetchToken(apiKey, model, voice, apiHost);
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
    const endpoint = `${host.replace(/\/$/, '')}/v1/realtime/client_secrets`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(EphemeralTokenService.CLIENT_SECRET_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model,
            audio: {
              output: { voice }
            }
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        throw new Error(`Failed to get ephemeral token: ${errorMessage}`);
      }

      const data: EphemeralTokenResponse = await response.json();
      const nestedSecret = typeof data.client_secret === 'string'
        ? data.client_secret
        : data.client_secret?.value;
      const tokenValue = data.value ?? nestedSecret;
      const nestedExpiresAt = typeof data.client_secret === 'object'
        ? data.client_secret.expires_at
        : undefined;
      const expiresAt = data.expires_at ?? nestedExpiresAt ?? Math.floor(Date.now() / 1000) + 60;

      if (!tokenValue) {
        throw new Error('Invalid token response: missing client_secret');
      }

      console.debug('[EphemeralTokenService] Obtained new ephemeral token, expires at:',
        new Date(expiresAt * 1000).toISOString());

      return tokenValue;
    } catch (error) {
      console.error('[EphemeralTokenService] Error fetching ephemeral token:', error);
      const message = error instanceof Error ? error.message : String(error);
      useLogStore.getState().addLog(`Failed to fetch OpenAI Realtime client secret: ${message}`, 'error');
      throw error;
    }
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
