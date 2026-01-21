import { IClient } from '../interfaces/IClient';
import { OpenAIClient } from './OpenAIClient';
import { OpenAIWebRTCClient } from './OpenAIWebRTCClient';
import { GeminiClient } from './GeminiClient';
import { PalabraAIClient } from './PalabraAIClient';
import { Provider, ProviderType } from '../../types/Provider';
import { getApiUrl, isKizunaAIEnabled } from '../../utils/environment';
import { TransportType } from '../../stores/settingsStore';

/**
 * Options for WebRTC client creation
 */
export interface WebRTCClientOptions {
  inputDeviceId?: string;
  outputDeviceId?: string;
}

/**
 * Factory for creating AI client instances
 * Determines the appropriate client based on model name and API keys
 */
export class ClientFactory {
  /**
   * Create an AI client instance based on the provider and model
   * @param model - The model name
   * @param provider - The provider type
   * @param apiKey - The API key for the specified provider
   * @param clientSecret - The client secret for PalabraAI (optional)
   * @param customEndpoint - The custom API endpoint for OpenAI Compatible provider (optional)
   * @param transportType - The transport type for OpenAI (websocket or webrtc)
   * @param webrtcOptions - Options for WebRTC client (device IDs)
   * @returns IClient instance
   */
  static createClient(
    model: string,
    provider: ProviderType,
    apiKey: string,
    clientSecret?: string,
    customEndpoint?: string,
    transportType?: TransportType,
    webrtcOptions?: WebRTCClientOptions
  ): IClient {
    if (!apiKey) {
      throw new Error(`API key is required for ${provider} provider`);
    }

    switch (provider) {
      case Provider.OPENAI:
        // Use WebRTC client if transport type is webrtc
        if (transportType === 'webrtc') {
          return new OpenAIWebRTCClient({
            apiKey,
            inputDeviceId: webrtcOptions?.inputDeviceId,
            outputDeviceId: webrtcOptions?.outputDeviceId
          });
        }
        return new OpenAIClient(apiKey);

      case Provider.OPENAI_COMPATIBLE:
        // OpenAI Compatible uses OpenAIClient with custom endpoint
        if (!customEndpoint) {
          throw new Error(`Custom endpoint is required for ${provider} provider`);
        }
        // WebRTC support for OpenAI Compatible
        if (transportType === 'webrtc') {
          return new OpenAIWebRTCClient({
            apiKey,
            apiHost: customEndpoint,
            inputDeviceId: webrtcOptions?.inputDeviceId,
            outputDeviceId: webrtcOptions?.outputDeviceId
          });
        }
        return new OpenAIClient(apiKey, customEndpoint);

      case Provider.GEMINI:
        return new GeminiClient(apiKey);

      case Provider.PALABRA_AI:
        if (!clientSecret) {
          throw new Error(`Client secret is required for ${provider} provider`);
        }
        // Pass inputDeviceId and outputDeviceId for native MediaStreamTrack with echo cancellation
        // The outputDeviceId is used for direct playback through HTMLAudioElement, which allows
        // the browser's AEC to see the remote audio and cancel it from microphone input
        return new PalabraAIClient(apiKey, clientSecret, webrtcOptions?.inputDeviceId, webrtcOptions?.outputDeviceId);

      case Provider.KIZUNA_AI:
        // Check if Kizuna AI is enabled before creating the client
        if (!isKizunaAIEnabled()) {
          throw new Error(`Provider ${provider} is not available in this build`);
        }
        // KizunaAI uses OpenAIClient with our Worker proxy
        // The proxy transparently handles both REST and WebSocket connections
        // The apiKey here is actually the auth session from Better Auth
        // Use environment-specific backend URL
        // Note: WebRTC is not yet supported for Kizuna AI (would require backend proxy)
        return new OpenAIClient(apiKey, getApiUrl());

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Check if a provider supports WebRTC transport
   */
  static supportsWebRTC(provider: ProviderType): boolean {
    return provider === Provider.OPENAI || provider === Provider.OPENAI_COMPATIBLE;
  }

  /**
   * Check if a provider uses native audio capture via MediaStreamTrack
   * This includes both OpenAI WebRTC and PalabraAI (LiveKit)
   * @param provider - The provider type
   * @param transportType - The transport type (optional, used to determine WebRTC mode)
   * @returns true if the provider uses native audio capture
   */
  static usesNativeAudioCapture(provider: ProviderType, transportType?: TransportType): boolean {
    // PalabraAI always uses native audio capture via LiveKit
    if (provider === Provider.PALABRA_AI) return true;
    // OpenAI/OpenAI Compatible use native audio capture only in WebRTC mode
    return transportType === 'webrtc' && this.supportsWebRTC(provider);
  }
} 