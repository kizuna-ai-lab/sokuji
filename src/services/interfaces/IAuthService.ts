/**
 * Authentication Service Interface
 * Provides unified authentication methods for both Electron and Chrome Extension platforms
 */

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  clerkId: string;
  subscription: 'free' | 'basic' | 'premium' | 'enterprise';
  tokenQuota: number;
  tokensUsed: number;
  apiKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSession {
  userId: string;
  sessionId: string;
  token: string;
  expiresAt: number;
  isValid: boolean;
}

export interface SignInOptions {
  strategy: 'oauth_google' | 'oauth_github' | 'email_code' | 'email_password';
  redirectUrl?: string;
}

export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  session?: AuthSession;
  error?: string;
}

export interface IAuthService {
  /**
   * Initialize the authentication service
   */
  initialize(): Promise<void>;
  
  /**
   * Sign in a user
   */
  signIn(options: SignInOptions): Promise<AuthResult>;
  
  /**
   * Sign out the current user
   */
  signOut(): Promise<void>;
  
  /**
   * Get the current authenticated user
   */
  getCurrentUser(): Promise<AuthUser | null>;
  
  /**
   * Get the current session
   */
  getSession(): Promise<AuthSession | null>;
  
  /**
   * Get a valid authentication token for API calls
   */
  getToken(): Promise<string | null>;
  
  /**
   * Refresh the current session token
   */
  refreshToken(): Promise<string | null>;
  
  /**
   * Check if user is authenticated
   */
  isAuthenticated(): Promise<boolean>;
  
  /**
   * Initialize user data after authentication
   * Fetches subscription info, API keys, quota, etc. from backend
   */
  initializeUserData(userId: string): Promise<AuthUser>;
  
  /**
   * Sync authentication state across platforms
   */
  syncAuthState(): Promise<void>;
  
  /**
   * Listen for authentication state changes
   */
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void;
}