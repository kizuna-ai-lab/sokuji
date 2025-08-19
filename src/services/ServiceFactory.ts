import { IAudioService } from './interfaces/IAudioService';
import { ISettingsService } from './interfaces/ISettingsService';
import { ModernBrowserAudioService } from '../lib/modern-audio/ModernBrowserAudioService';
import { SettingsService } from './SettingsService';
import { isElectron as checkIsElectron, isExtension as checkIsExtension } from '../utils/environment';

/**
 * Service Factory for creating platform-specific service implementations
 */
export class ServiceFactory {
  // Static cache for service instances
  private static audioServiceInstance: IAudioService | null = null;
  private static settingsServiceInstance: ISettingsService | null = null;
  
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
    
    // Create unified settings service for all platforms
    console.info('[Sokuji] [ServiceFactory] Creating unified settings service');
    ServiceFactory.settingsServiceInstance = new SettingsService();
    
    return ServiceFactory.settingsServiceInstance;
  }
  
  
  
  /**
   * Reset all cached service instances
   * Useful for testing or when switching users
   */
  static resetAllInstances(): void {
    ServiceFactory.audioServiceInstance = null;
    ServiceFactory.settingsServiceInstance = null;
  }
}
