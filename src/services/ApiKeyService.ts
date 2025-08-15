/**
 * API Key Service
 * Previously handled fetching API keys from backend for authenticated providers
 * Now simplified - Kizuna AI directly uses Clerk tokens as API keys
 */

export class ApiKeyService {
  // Simplified service - no longer fetches API keys from backend
  // KizunaAI now uses Clerk tokens directly as API keys
}

// Create a singleton instance for backward compatibility
export const apiKeyService = new ApiKeyService();