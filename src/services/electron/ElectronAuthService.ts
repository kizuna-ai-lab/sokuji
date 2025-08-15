/**
 * Electron implementation of the Authentication Service
 * Uses Clerk for authentication with secure storage
 */

import { 
  IAuthService, 
  AuthUser, 
  AuthSession, 
  SignInOptions, 
  AuthResult 
} from '../interfaces/IAuthService';

export class ElectronAuthService implements IAuthService {
  private authStateListeners: ((user: AuthUser | null) => void)[] = [];
  private backendUrl: string = import.meta.env.VITE_BACKEND_URL || 'https://api.sokuji.ai';
  private currentUser: AuthUser | null = null;
  private currentSession: AuthSession | null = null;
  
  async initialize(): Promise<void> {
    // Check if we have a stored session
    const session = await this.getStoredSession();
    if (session && session.isValid && session.expiresAt > Date.now()) {
      // Session is still valid, fetch user data
      this.currentSession = session;
      const user = await this.fetchUserData(session.userId);
      if (user) {
        this.currentUser = user;
        this.notifyAuthStateChange(user);
      }
    }
  }
  
  async signIn(options: SignInOptions): Promise<AuthResult> {
    try {
      // Use Electron's BrowserWindow for OAuth
      if (options.strategy.startsWith('oauth_')) {
        return await this.handleOAuthSignIn(options);
      }
      
      // For email-based auth, open in BrowserWindow
      return await this.handleEmailSignIn(options);
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Sign in failed'
      };
    }
  }
  
  private async handleOAuthSignIn(options: SignInOptions): Promise<AuthResult> {
    const provider = options.strategy.replace('oauth_', '');
    const authUrl = `${this.backendUrl}/auth/oauth/${provider}`;
    
    return new Promise(async (resolve) => {
      // Use Electron API to open auth window
      if (window.electronAPI) {
        try {
          const result = await window.electronAPI.openAuthWindow(authUrl);
          
          if (result.success && result.token && result.userId) {
            // Store session
            const session: AuthSession = {
              userId: result.userId,
              sessionId: crypto.randomUUID(),
              token: result.token,
              expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
              isValid: true
            };
            
            await this.storeSession(session);
            this.currentSession = session;
            
            const user = await this.initializeUserData(result.userId);
            this.currentUser = user;
            
            resolve({
              success: true,
              user,
              session
            });
          } else {
            resolve({
              success: false,
              error: result.error || 'Authentication failed'
            });
          }
        } catch (error: any) {
          resolve({
            success: false,
            error: error.message || 'Authentication failed'
          });
        }
      } else {
        resolve({
          success: false,
          error: 'Electron API not available'
        });
      }
    });
  }
  
  private async handleEmailSignIn(options: SignInOptions): Promise<AuthResult> {
    const signInUrl = `${this.backendUrl}/auth/signin?method=${options.strategy}`;
    
    return new Promise(async (resolve) => {
      if (window.electronAPI) {
        try {
          const result = await window.electronAPI.openAuthWindow(signInUrl);
          
          if (result.success && result.token && result.userId) {
            const session: AuthSession = {
              userId: result.userId,
              sessionId: result.sessionId || crypto.randomUUID(),
              token: result.token,
              expiresAt: result.expiresAt || Date.now() + 24 * 60 * 60 * 1000,
              isValid: true
            };
            
            await this.storeSession(session);
            this.currentSession = session;
            
            const user = await this.initializeUserData(result.userId);
            this.currentUser = user;
            
            resolve({
              success: true,
              user,
              session
            });
          } else {
            resolve({
              success: false,
              error: result.error || 'Authentication failed'
            });
          }
        } catch (error: any) {
          resolve({
            success: false,
            error: error.message || 'Authentication failed'
          });
        }
      } else {
        resolve({
          success: false,
          error: 'Electron API not available'
        });
      }
    });
  }
  
  async signOut(): Promise<void> {
    // Clear stored session
    await this.clearSession();
    
    // Notify backend
    const token = await this.getToken();
    if (token) {
      const deviceId = await this.getDeviceId();
      await fetch(`${this.backendUrl}/api/auth/signout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Device-Id': deviceId
        }
      });
    }
    
    this.currentUser = null;
    this.currentSession = null;
    this.notifyAuthStateChange(null);
  }
  
  async getCurrentUser(): Promise<AuthUser | null> {
    if (this.currentUser) {
      return this.currentUser;
    }
    
    const session = await this.getStoredSession();
    if (!session || !session.isValid) {
      return null;
    }
    
    const user = await this.fetchUserData(session.userId);
    this.currentUser = user;
    return user;
  }
  
  async getSession(): Promise<AuthSession | null> {
    if (this.currentSession) {
      return this.currentSession;
    }
    
    const session = await this.getStoredSession();
    this.currentSession = session;
    return session;
  }
  
  async getToken(): Promise<string | null> {
    const session = this.currentSession || await this.getStoredSession();
    
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
    const session = this.currentSession || await this.getStoredSession();
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
        this.currentSession = session;
        
        return data.token;
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
    
    return null;
  }
  
  async isAuthenticated(): Promise<boolean> {
    const session = this.currentSession || await this.getStoredSession();
    return session !== null && session.isValid && session.expiresAt > Date.now();
  }
  
  async initializeUserData(userId: string): Promise<AuthUser> {
    const token = await this.getToken();
    if (!token) {
      throw new Error('No authentication token');
    }
    
    // Fetch user profile from backend
    const response = await fetch(`${this.backendUrl}/api/user/profile`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to initialize user data');
    }
    
    const data = await response.json();
    
    const userData: AuthUser = {
      id: data.user.id,
      email: data.user.email,
      firstName: data.user.firstName,
      lastName: data.user.lastName,
      imageUrl: data.user.imageUrl,
      clerkId: data.user.id,
      subscription: data.user.subscription,
      tokenQuota: data.quota.total,
      tokensUsed: data.quota.used,
      createdAt: new Date(data.user.createdAt),
      updatedAt: new Date(data.user.updatedAt)
    };
    
    // Store user data
    await this.storeUserData(userData);
    this.currentUser = userData;
    
    this.notifyAuthStateChange(userData);
    
    return userData;
  }
  
  async syncAuthState(): Promise<void> {
    const session = this.currentSession || await this.getStoredSession();
    const user = this.currentUser || await this.getCurrentUser();
    
    if (!session || !user) {
      return;
    }
    
    const deviceId = await this.getDeviceId();
    
    // Sync with backend
    await fetch(`${this.backendUrl}/api/auth/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`,
        'X-Device-Id': deviceId,
        'X-Platform': 'electron'
      },
      body: JSON.stringify({
        platform: 'electron',
        deviceId,
        session,
        user
      })
    });
  }
  
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
    this.authStateListeners.push(callback);
    
    // Immediately call with current state
    callback(this.currentUser);
    
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
    if (window.electronAPI) {
      try {
        const sessionData = await window.electronAPI.getSecureData('authSession');
        if (sessionData) {
          return JSON.parse(sessionData) as AuthSession;
        }
      } catch (error) {
        console.error('Failed to get stored session:', error);
      }
    }
    return null;
  }
  
  private async storeSession(session: AuthSession): Promise<void> {
    if (window.electronAPI) {
      try {
        await window.electronAPI.setSecureData('authSession', JSON.stringify(session));
      } catch (error) {
        console.error('Failed to store session:', error);
      }
    }
  }
  
  private async clearSession(): Promise<void> {
    if (window.electronAPI) {
      try {
        await window.electronAPI.deleteSecureData('authSession');
        await window.electronAPI.deleteSecureData('authUser');
      } catch (error) {
        console.error('Failed to clear session:', error);
      }
    }
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
      const response = await fetch(`${this.backendUrl}/api/user/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const user: AuthUser = {
          id: data.user.id,
          email: data.user.email,
          firstName: data.user.firstName,
          lastName: data.user.lastName,
          imageUrl: data.user.imageUrl,
          clerkId: data.user.id,
          subscription: data.user.subscription,
          tokenQuota: data.quota.total,
          tokensUsed: data.quota.used,
          createdAt: new Date(data.user.createdAt),
          updatedAt: new Date(data.user.updatedAt)
        };
        
        await this.storeUserData(user);
        return user;
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    }
    
    return null;
  }
  
  private async getCachedUserData(): Promise<AuthUser | null> {
    if (window.electronAPI) {
      try {
        const userData = await window.electronAPI.getSecureData('authUser');
        if (userData) {
          return JSON.parse(userData) as AuthUser;
        }
      } catch (error) {
        console.error('Failed to get cached user data:', error);
      }
    }
    return null;
  }
  
  private async storeUserData(user: AuthUser): Promise<void> {
    if (window.electronAPI) {
      try {
        await window.electronAPI.setSecureData('authUser', JSON.stringify(user));
      } catch (error) {
        console.error('Failed to store user data:', error);
      }
    }
  }
  
  private async getDeviceId(): Promise<string> {
    if (window.electronAPI) {
      try {
        let deviceId = await window.electronAPI.getSecureData('deviceId');
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          await window.electronAPI.setSecureData('deviceId', deviceId);
        }
        return deviceId;
      } catch (error) {
        console.error('Failed to get device ID:', error);
      }
    }
    return crypto.randomUUID();
  }
  
  private notifyAuthStateChange(user: AuthUser | null): void {
    this.authStateListeners.forEach(listener => listener(user));
  }
}