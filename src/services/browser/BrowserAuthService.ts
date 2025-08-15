/**
 * Chrome Extension implementation of the Authentication Service
 * Uses chrome.identity API and chrome.storage for authentication
 */

import { 
  IAuthService, 
  AuthUser, 
  AuthSession, 
  SignInOptions, 
  AuthResult 
} from '../interfaces/IAuthService';

export class BrowserAuthService implements IAuthService {
  private authStateListeners: ((user: AuthUser | null) => void)[] = [];
  private backendUrl: string = import.meta.env.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai';
  
  async initialize(): Promise<void> {
    // Check if we have a stored session
    const session = await this.getStoredSession();
    if (session && session.isValid && session.expiresAt > Date.now()) {
      // Session is still valid, fetch user data
      const user = await this.fetchUserData(session.userId);
      if (user) {
        this.notifyAuthStateChange(user);
      }
    }
  }
  
  async signIn(options: SignInOptions): Promise<AuthResult> {
    try {
      // Use chrome.identity API for OAuth
      if (options.strategy.startsWith('oauth_')) {
        return await this.handleOAuthSignIn(options);
      }
      
      // For email-based auth, open a new tab with Clerk hosted page
      return await this.handleEmailSignIn(options);
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Sign in failed'
      };
    }
  }
  
  private async handleOAuthSignIn(options: SignInOptions): Promise<AuthResult> {
    return new Promise((resolve) => {
      const provider = options.strategy.replace('oauth_', '');
      const authUrl = `${this.backendUrl}/auth/oauth/${provider}?extension=true`;
      
      // @ts-ignore - Chrome API
      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl,
          interactive: true
        },
        async (redirectUrl) => {
          // @ts-ignore - Chrome API
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              // @ts-ignore - Chrome API
              error: chrome.runtime.lastError.message
            });
            return;
          }
          
          if (redirectUrl) {
            // Extract token from redirect URL
            const url = new URL(redirectUrl);
            const token = url.searchParams.get('token');
            const userId = url.searchParams.get('userId');
            
            if (token && userId) {
              // Store session
              const session: AuthSession = {
                userId,
                sessionId: crypto.randomUUID(),
                token,
                expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
                isValid: true
              };
              
              await this.storeSession(session);
              const user = await this.initializeUserData(userId);
              
              resolve({
                success: true,
                user,
                session
              });
            } else {
              resolve({
                success: false,
                error: 'Invalid authentication response'
              });
            }
          }
        }
      );
    });
  }
  
  private async handleEmailSignIn(options: SignInOptions): Promise<AuthResult> {
    // Open Clerk hosted sign-in page in a new tab
    const signInUrl = `${this.backendUrl}/auth/signin?method=${options.strategy}&extension=true`;
    
    // @ts-ignore - Chrome API
    chrome.tabs.create({ url: signInUrl });
    
    // Listen for the auth completion message
    return new Promise((resolve) => {
      const listener = async (request: any, sender: any) => {
        if (request.type === 'AUTH_COMPLETE') {
          // @ts-ignore - Chrome API
          chrome.runtime.onMessage.removeListener(listener);
          
          const session: AuthSession = {
            userId: request.userId,
            sessionId: request.sessionId,
            token: request.token,
            expiresAt: request.expiresAt,
            isValid: true
          };
          
          await this.storeSession(session);
          const user = await this.initializeUserData(request.userId);
          
          resolve({
            success: true,
            user,
            session
          });
        }
      };
      
      // @ts-ignore - Chrome API
      chrome.runtime.onMessage.addListener(listener);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        // @ts-ignore - Chrome API
        chrome.runtime.onMessage.removeListener(listener);
        resolve({
          success: false,
          error: 'Authentication timeout'
        });
      }, 300000);
    });
  }
  
  async signOut(): Promise<void> {
    // Clear stored session
    await this.clearSession();
    
    // Notify backend
    const token = await this.getToken();
    if (token) {
      await fetch(`${this.backendUrl}/api/auth/signout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    }
    
    this.notifyAuthStateChange(null);
  }
  
  async getCurrentUser(): Promise<AuthUser | null> {
    const session = await this.getStoredSession();
    if (!session || !session.isValid) {
      return null;
    }
    
    return await this.fetchUserData(session.userId);
  }
  
  async getSession(): Promise<AuthSession | null> {
    return await this.getStoredSession();
  }
  
  async getToken(): Promise<string | null> {
    const session = await this.getStoredSession();
    
    if (!session) {
      return null;
    }
    
    // Check if token is expired
    if (session.expiresAt < Date.now()) {
      // Try to refresh
      const newToken = await this.refreshToken();
      return newToken;
    }
    
    return session.token;
  }
  
  async refreshToken(): Promise<string | null> {
    const session = await this.getStoredSession();
    if (!session) {
      return null;
    }
    
    try {
      const response = await fetch(`${this.backendUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Update stored session
        session.token = data.token;
        session.expiresAt = data.expiresAt;
        await this.storeSession(session);
        
        return data.token;
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
    
    return null;
  }
  
  async isAuthenticated(): Promise<boolean> {
    const session = await this.getStoredSession();
    return session !== null && session.isValid && session.expiresAt > Date.now();
  }
  
  async initializeUserData(userId: string): Promise<AuthUser> {
    const token = await this.getToken();
    if (!token) {
      throw new Error('No authentication token');
    }
    
    const response = await fetch(`${this.backendUrl}/api/user/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });
    
    if (!response.ok) {
      throw new Error('Failed to initialize user data');
    }
    
    const userData = await response.json();
    
    // Store user data
    await this.storeUserData(userData);
    
    this.notifyAuthStateChange(userData);
    
    return userData;
  }
  
  async syncAuthState(): Promise<void> {
    const session = await this.getStoredSession();
    const user = await this.getCurrentUser();
    
    if (!session || !user) {
      return;
    }
    
    // Sync with backend
    await fetch(`${this.backendUrl}/api/auth/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`
      },
      body: JSON.stringify({
        platform: 'extension',
        deviceId: await this.getDeviceId(),
        session,
        user
      })
    });
  }
  
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
    this.authStateListeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.authStateListeners.indexOf(callback);
      if (index > -1) {
        this.authStateListeners.splice(index, 1);
      }
    };
  }
  
  // Private helper methods
  
  private async getStoredSession(): Promise<AuthSession | null> {
    return new Promise((resolve) => {
      // @ts-ignore - Chrome API
      chrome.storage.local.get('authSession', (result: any) => {
        resolve(result.authSession || null);
      });
    });
  }
  
  private async storeSession(session: AuthSession): Promise<void> {
    return new Promise((resolve) => {
      // @ts-ignore - Chrome API
      chrome.storage.local.set({ authSession: session }, resolve);
    });
  }
  
  private async clearSession(): Promise<void> {
    return new Promise((resolve) => {
      // @ts-ignore - Chrome API
      chrome.storage.local.remove(['authSession', 'authUser'], resolve);
    });
  }
  
  private async fetchUserData(userId: string): Promise<AuthUser | null> {
    // First check cache
    const cached = await this.getCachedUserData();
    if (cached && cached.id === userId) {
      return cached;
    }
    
    // Fetch from backend
    const token = await this.getToken();
    if (!token) {
      return null;
    }
    
    try {
      const response = await fetch(`${this.backendUrl}/api/user/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const user = await response.json();
        await this.storeUserData(user);
        return user;
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    }
    
    return null;
  }
  
  private async getCachedUserData(): Promise<AuthUser | null> {
    return new Promise((resolve) => {
      // @ts-ignore - Chrome API
      chrome.storage.local.get('authUser', (result: any) => {
        resolve(result.authUser || null);
      });
    });
  }
  
  private async storeUserData(user: AuthUser): Promise<void> {
    return new Promise((resolve) => {
      // @ts-ignore - Chrome API
      chrome.storage.local.set({ authUser: user }, resolve);
    });
  }
  
  private async getDeviceId(): Promise<string> {
    return new Promise((resolve) => {
      // @ts-ignore - Chrome API
      chrome.storage.local.get('deviceId', (result: any) => {
        if (result.deviceId) {
          resolve(result.deviceId);
        } else {
          const deviceId = crypto.randomUUID();
          // @ts-ignore - Chrome API
          chrome.storage.local.set({ deviceId }, () => {
            resolve(deviceId);
          });
        }
      });
    });
  }
  
  private notifyAuthStateChange(user: AuthUser | null): void {
    this.authStateListeners.forEach(listener => listener(user));
  }
}