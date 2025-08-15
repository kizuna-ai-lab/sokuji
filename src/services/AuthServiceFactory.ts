/**
 * Factory for creating platform-specific authentication service implementations
 */

import { IAuthService } from './interfaces/IAuthService';
import { BrowserAuthService } from './browser/BrowserAuthService';
import { ElectronAuthService } from './electron/ElectronAuthService';
import { ServiceFactory } from './ServiceFactory';

export class AuthServiceFactory {
  private static authServiceInstance: IAuthService | null = null;
  
  /**
   * Get the appropriate authentication service for the current platform
   * Returns a cached instance if one exists
   */
  static getAuthService(): IAuthService {
    // Return cached instance if available
    if (AuthServiceFactory.authServiceInstance) {
      return AuthServiceFactory.authServiceInstance;
    }
    
    // Create new instance based on platform
    if (ServiceFactory.isElectron()) {
      console.info('[Sokuji] [AuthServiceFactory] Creating Electron authentication service');
      AuthServiceFactory.authServiceInstance = new ElectronAuthService();
    } else if (ServiceFactory.isBrowserExtension()) {
      console.info('[Sokuji] [AuthServiceFactory] Creating Browser extension authentication service');
      AuthServiceFactory.authServiceInstance = new BrowserAuthService();
    } else {
      // Fallback to browser service for web app
      console.info('[Sokuji] [AuthServiceFactory] Creating Browser authentication service (web app)');
      AuthServiceFactory.authServiceInstance = new BrowserAuthService();
    }
    
    return AuthServiceFactory.authServiceInstance;
  }
  
  /**
   * Reset the cached instance (useful for testing or logout)
   */
  static resetInstance(): void {
    AuthServiceFactory.authServiceInstance = null;
  }
}