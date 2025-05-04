import { IAudioService } from './interfaces/IAudioService';
import { ISettingsService } from './interfaces/ISettingsService';
import { ElectronAudioService } from './electron/ElectronAudioService';
import { BrowserAudioService } from './browser/BrowserAudioService';
import { ElectronSettingsService } from './electron/ElectronSettingsService';
import { BrowserSettingsService } from './browser/BrowserSettingsService';

/**
 * Service Factory for creating platform-specific service implementations
 */
export class ServiceFactory {
  // Static cache for service instances
  private static audioServiceInstance: IAudioService | null = null;
  private static settingsServiceInstance: ISettingsService | null = null;
  
  /**
   * Detect if the code is running in an Electron environment
   */
  static isElectron(): boolean {
    // Primary check: Electron's process object with type=renderer
    // @ts-ignore
    if (typeof window !== 'undefined' && typeof window.process === 'object' && window.process.type === 'renderer') {
      return true;
    }
    
    // Secondary check: Look for Electron-specific versions
    // @ts-ignore
    if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && navigator.userAgent.indexOf('Electron') >= 0) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Detect if the code is running in a browser extension
   */
  static isBrowserExtension(): boolean {
    // Check for Chrome extension API
    // @ts-ignore
    if (typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined' && chrome.runtime.id) {
      return true;
    }
    
    // Check for Firefox extension API (browser namespace)
    // @ts-ignore
    if (typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined' && browser.runtime.id) {
      return true;
    }
    
    return false;
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
    
    // Create new instance if needed
    if (ServiceFactory.isElectron()) {
      console.log('Creating Electron audio service');
      ServiceFactory.audioServiceInstance = new ElectronAudioService();
    } else {
      console.log('Creating Browser audio service');
      ServiceFactory.audioServiceInstance = new BrowserAudioService();
    }
    
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
      console.log('Creating Electron settings service');
      ServiceFactory.settingsServiceInstance = new ElectronSettingsService();
    } else {
      console.log('Creating Browser settings service');
      ServiceFactory.settingsServiceInstance = new BrowserSettingsService();
    }
    
    return ServiceFactory.settingsServiceInstance;
  }
}
