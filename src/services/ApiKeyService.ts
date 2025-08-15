/**
 * API Key Service
 * Handles fetching API keys from the backend for authenticated providers like Kizuna AI
 */

export interface ApiKeyResponse {
  apiKey: string;
  provider: string;
  createdAt: string;
}

export class ApiKeyService {
  private backendUrl: string;
  private apiKeyCache: Map<string, { apiKey: string; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

  constructor(backendUrl?: string) {
    this.backendUrl = backendUrl || import.meta.env.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai';
  }

  /**
   * Fetch API key for a specific provider from the backend
   * @param provider - The provider to fetch API key for
   * @param getToken - Function to get the authentication token
   * @returns Promise<string | null> - The API key or null if failed
   */
  async fetchApiKey(
    provider: string,
    getToken: () => Promise<string | null>
  ): Promise<string | null> {
    try {
      // Check cache first
      const cacheKey = `${provider}-apikey`;
      const cached = this.apiKeyCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.apiKey;
      }

      // Get authentication token
      const token = await getToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      // Fetch API key from backend
      const response = await fetch(`${this.backendUrl}/api/user/api-key`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Not authenticated');
        } else if (response.status === 404) {
          throw new Error('API key not found');
        } else {
          throw new Error(`Failed to fetch API key: ${response.statusText}`);
        }
      }

      const data: ApiKeyResponse = await response.json();
      
      // Cache the API key
      this.apiKeyCache.set(cacheKey, {
        apiKey: data.apiKey,
        timestamp: Date.now()
      });

      return data.apiKey;
    } catch (error: any) {
      console.error(`[ApiKeyService] Error fetching API key for ${provider}:`, error);
      return null;
    }
  }

  /**
   * Clear cached API key for a provider
   * @param provider - The provider to clear cache for
   */
  clearCache(provider?: string): void {
    if (provider) {
      const cacheKey = `${provider}-apikey`;
      this.apiKeyCache.delete(cacheKey);
    } else {
      // Clear all cache
      this.apiKeyCache.clear();
    }
  }

  /**
   * Check if API key is cached and still valid
   * @param provider - The provider to check
   * @returns boolean - True if cached and valid
   */
  isCached(provider: string): boolean {
    const cacheKey = `${provider}-apikey`;
    const cached = this.apiKeyCache.get(cacheKey);
    return cached !== undefined && Date.now() - cached.timestamp < this.CACHE_DURATION;
  }
}

// Create a singleton instance
export const apiKeyService = new ApiKeyService();