import { IClient } from '../interfaces/IClient';
import { ProviderType } from '../../types/Provider';
import { TransportType } from '../../stores/settingsStore';
import { ProviderConfigFactory } from '../providers/ProviderConfigFactory';

/**
 * Options for WebRTC client creation
 */
export interface WebRTCClientOptions {
  inputDeviceId?: string;
  outputDeviceId?: string;
}

/**
 * @deprecated Thin façade kept for legacy tests. New code resolves the
 * descriptor via ProviderConfigFactory.getDescriptor(provider) directly.
 */
export class ClientFactory {
  static createClient(
    model: string, provider: ProviderType, apiKey: string,
    clientSecret?: string, customEndpoint?: string,
    transportType?: TransportType, webrtcOptions?: WebRTCClientOptions
  ): IClient {
    void model;
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
