/**
 * Node.js Client Factory
 *
 * Creates appropriate AI client instances for different providers.
 * Currently supports OpenAI and OpenAI-compatible APIs.
 */

import { NodeOpenAIClient } from './NodeOpenAIClient.js';
import type { TestProvider, RunnerConfig } from '../types.js';
import { getApiKeyForProvider } from '../config.js';

/**
 * Client interface for the test runner
 */
export interface TestClient {
  connect(config: Record<string, unknown>): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  appendInputAudio(audioData: Int16Array): void;
  commitInputAudio(): void;
  clearInputAudio(): void;
  sendTextInput(text: string): void;
  createResponse(): void;
  getCurrentResponseText(): string;
  setEventHandlers(handlers: Record<string, unknown>): void;
}

/**
 * Create a client for the specified provider
 */
export function createClient(
  provider: TestProvider,
  config: RunnerConfig,
  apiHost?: string
): TestClient {
  const apiKey = getApiKeyForProvider(config, provider);

  if (!apiKey) {
    throw new Error(`No API key configured for provider: ${provider}`);
  }

  switch (provider) {
    case 'openai':
      return new NodeOpenAIClient(apiKey, apiHost || 'wss://api.openai.com');

    case 'openai_compatible':
      if (!apiHost) {
        throw new Error('OpenAI-compatible provider requires an API host');
      }
      return new NodeOpenAIClient(apiKey, apiHost);

    case 'kizuna_ai':
      // Kizuna AI uses OpenAI-compatible API
      return new NodeOpenAIClient(apiKey, apiHost || 'wss://sokuji.kizuna.ai');

    case 'gemini':
      throw new Error('Gemini provider not yet implemented in test runner');

    case 'palabra_ai':
      throw new Error('PalabraAI provider not yet implemented in test runner');

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Check if a provider is supported
 */
export function isProviderSupported(provider: TestProvider): boolean {
  return ['openai', 'openai_compatible', 'kizuna_ai'].includes(provider);
}

/**
 * Get list of supported providers
 */
export function getSupportedProviders(): TestProvider[] {
  return ['openai', 'openai_compatible', 'kizuna_ai'];
}
