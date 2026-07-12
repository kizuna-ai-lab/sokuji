import { IClient } from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { TransportType } from '../providers/ProviderDescriptor';
import { ProviderConfigFactory } from '../providers/ProviderConfigFactory';

/**
 * Options for WebRTC client creation
 */
export interface WebRTCClientOptions {
  inputDeviceId?: string;
  outputDeviceId?: string;
}

/**
 * @deprecated Thin façade kept for legacy callers and tests. New code should
 * resolve the descriptor via ProviderConfigFactory.getDescriptor(provider)
 * directly instead of going through this class.
 */
export class ClientFactory {
  static createClient(
    model: string, provider: ProviderType, apiKey: string,
    clientSecret?: string, customEndpoint?: string,
    transportType?: TransportType, webrtcOptions?: WebRTCClientOptions
  ): IClient {
    void model;
    // Legacy callers skip extractCredentials — keep the old façade contract of
    // rejecting an empty key up front (LOCAL_INFERENCE and LOCAL_NATIVE never
    // had credentials).
    if (!apiKey && provider !== Provider.LOCAL_INFERENCE && provider !== Provider.LOCAL_NATIVE) {
      throw new Error(`API key is required for ${provider} provider`);
    }
    return ProviderConfigFactory.getDescriptor(provider).createClient(
      { ok: true, primary: apiKey, secret: clientSecret, endpoint: customEndpoint },
      { transport: transportType ?? 'websocket', webrtcOptions }
    );
  }

  static supportsWebRTC(provider: ProviderType): boolean {
    return ProviderConfigFactory.getDescriptor(provider).supportsWebRTC;
  }

  static usesNativeAudioCapture(provider: ProviderType, transportType?: TransportType): boolean {
    return transportType === 'webrtc' && this.supportsWebRTC(provider);
  }
}
