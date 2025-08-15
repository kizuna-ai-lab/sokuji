import { IAudioService } from './interfaces/IAudioService';
import { ISettingsService } from './interfaces/ISettingsService';
import { IAuthService } from './interfaces/IAuthService';
import { IQuotaService } from './interfaces/IQuotaService';
import { ModernBrowserAudioService } from '../lib/modern-audio/ModernBrowserAudioService';
import { ElectronSettingsService } from './electron/ElectronSettingsService';
import { BrowserSettingsService } from './browser/BrowserSettingsService';
import { AuthServiceFactory } from './AuthServiceFactory';
import { QuotaService } from './QuotaService';
import { isElectron as checkIsElectron, isExtension as checkIsExtension } from '../utils/environment';

/**
 * Service Factory for creating platform-specific service implementations
 */
export class ServiceFactory {
  // Static cache for service instances
  private static audioServiceInstance: IAudioService | null = null;
  private static settingsServiceInstance: ISettingsService | null = null;
  private static authServiceInstance: IAuthService | null = null;
  private static quotaServiceInstance: IQuotaService | null = null;
  
  /**
   * Detect if the code is running in an Electron environment
   * Uses centralized detection from utils/environment
   */
  static isElectron(): boolean {
    return checkIsElectron();
  }
  
  /**
   * Detect if the code is running in a browser extension
   * Uses centralized detection from utils/environment
   */
  static isBrowserExtension(): boolean {
    return checkIsExtension();
  }
  
  /**
   * Create the appropriate IAudioService implementation based on the environment
   * Returns a cached instance if one exists
   */
  static getAudioService(): IAudioService {
    // Return cached instance if available
    if (ServiceFactory.audioServiceInstance) {
      return ServiceFactory.audioServiceInstance;
    }
    
    // Create new instance if needed - both platforms now use the same unified service
    console.info('[Sokuji] [ServiceFactory] Creating Modern Browser audio service (unified for all platforms)');
    ServiceFactory.audioServiceInstance = new ModernBrowserAudioService();
    
    return ServiceFactory.audioServiceInstance;
  }
  
  /**
   * Create the appropriate ISettingsService implementation based on the environment
   * Returns a cached instance if one exists
   */
  static getSettingsService(): ISettingsService {
    // Return cached instance if available
    if (ServiceFactory.settingsServiceInstance) {
      return ServiceFactory.settingsServiceInstance;
    }
    
    // Create new instance if needed
    if (ServiceFactory.isElectron()) {
      console.info('[Sokuji] [ServiceFactory] Creating Electron settings service');
      ServiceFactory.settingsServiceInstance = new ElectronSettingsService();
    } else {
      console.info('[Sokuji] [ServiceFactory] Creating Browser settings service');
      ServiceFactory.settingsServiceInstance = new BrowserSettingsService();
    }
    
    return ServiceFactory.settingsServiceInstance;
  }
  
  /**
   * Create the appropriate IAuthService implementation based on the environment
   * Returns a cached instance if one exists
   */
  static getAuthService(): IAuthService {
    // Return cached instance if available
    if (ServiceFactory.authServiceInstance) {
      return ServiceFactory.authServiceInstance;
    }
    
    // Delegate to AuthServiceFactory
    ServiceFactory.authServiceInstance = AuthServiceFactory.getAuthService();
    return ServiceFactory.authServiceInstance;
  }
  
  /**
   * Create the appropriate IQuotaService implementation based on the environment
   * Returns a cached instance if one exists
   */
  static getQuotaService(): IQuotaService {
    // Return cached instance if available
    if (ServiceFactory.quotaServiceInstance) {
      return ServiceFactory.quotaServiceInstance;
    }
    
    // Create unified quota service for all platforms
    console.info('[Sokuji] [ServiceFactory] Creating unified quota service');
    ServiceFactory.quotaServiceInstance = new QuotaService();
    return ServiceFactory.quotaServiceInstance;
  }
  
  /**
   * Reset all cached service instances
   * Useful for testing or when switching users
   */
  static resetAllInstances(): void {
    ServiceFactory.audioServiceInstance = null;
    ServiceFactory.settingsServiceInstance = null;
    
    // Reset auth and quota services
    AuthServiceFactory.resetInstance();
    ServiceFactory.authServiceInstance = null;
    ServiceFactory.quotaServiceInstance = null;
  }
}
