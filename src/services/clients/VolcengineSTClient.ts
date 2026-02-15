import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
  VolcengineSTSessionConfig
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import i18n from '../../locales';

/**
 * Volcengine ST Real-time Speech Translation response subtitle
 */
interface VolcengineSTSubtitle {
  Text: string;
  BeginTime: number;
  EndTime: number;
  Definite: boolean;
  Language: string;
  Sequence: number;
}

/**
 * Volcengine ST WebSocket message types
 */
interface VolcengineSTConfigMessage {
  Configuration: {
    SourceLanguage: string;
    TargetLanguages: string[];
    HotWordList?: Array<{ Word: string; Scale: number }>;
  };
}

interface VolcengineSTAudioMessage {
  AudioData: string; // Base64 encoded PCM audio
}

interface VolcengineSTEndMessage {
  End: boolean;
}

/**
 * Browser-compatible V4 signature utility for Volcengine API
 * Implements HMAC-SHA256 signature algorithm similar to AWS Signature V4
 */
class VolcengineV4Signer {
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;
  private service: string;

  constructor(accessKeyId: string, secretAccessKey: string, region: string, service: string) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
    this.service = service;
  }

  /**
   * Generate signed URL for WebSocket connection
   * Matches the SDK's getSignUrl behavior:
   * 1. Add auth params to query (excluding X-SignedQueries and X-Signature)
   * 2. Sign with all query params and EMPTY headers
   * 3. Then add X-SignedQueries and X-Signature
   */
  async generateSignedUrl(host: string, path: string, action: string, version: string): Promise<string> {
    const now = new Date();
    const dateStr = this.formatDate(now);
    const dateOnlyStr = dateStr.slice(0, 8);

    // Credential scope
    const credentialScope = `${dateOnlyStr}/${this.region}/${this.service}/request`;

    // All query params for signing (auth params included, but NOT X-SignedQueries and X-Signature)
    const signingParams: Record<string, string> = {
      'Action': action,
      'Version': version,
      'X-Algorithm': 'HMAC-SHA256',
      'X-Credential': `${this.accessKeyId}/${credentialScope}`,
      'X-Date': dateStr,
      'X-NotSignBody': '',
      'X-SignedHeaders': '',
    };

    // Create canonical request with all signing params and EMPTY headers
    const canonicalRequest = await this.createCanonicalRequest(
      'GET',
      path,
      signingParams,
      {}, // empty headers (SDK clears headers for URL signing)
      '',  // empty signed headers
      ''   // empty body
    );

    // Create string to sign
    const stringToSign = await this.createStringToSign(dateStr, credentialScope, canonicalRequest);

    // Calculate signature
    const signature = await this.calculateSignature(dateOnlyStr, stringToSign);

    // Build final URL: add X-SignedQueries (all signing param keys) and X-Signature
    const finalParams: Record<string, string> = {
      ...signingParams,
      'X-SignedQueries': Object.keys(signingParams).sort().join(';'),
      'X-Signature': signature,
    };

    const urlParams = new URLSearchParams(finalParams);
    return `wss://${host}${path}?${urlParams.toString()}`;
  }

  /**
   * Generate signed headers for HTTP request
   */
  async generateSignedHeaders(
    host: string,
    path: string,
    method: string,
    action: string,
    version: string,
    body: string
  ): Promise<Record<string, string>> {
    const now = new Date();
    const dateStr = this.formatDate(now);
    const dateOnlyStr = dateStr.slice(0, 8);

    // Calculate body hash
    const bodyHash = await this.sha256Hex(body);

    // Query parameters
    const queryParams: Record<string, string> = {
      'Action': action,
      'Version': version,
    };

    // Headers to sign
    const signedHeaderNames = ['content-type', 'host', 'x-content-sha256', 'x-date'];
    const headersToSign: Record<string, string> = {
      'content-type': 'application/json',
      'host': host,
      'x-content-sha256': bodyHash,
      'x-date': dateStr,
    };

    // Create canonical request
    const canonicalRequest = await this.createCanonicalRequest(
      method,
      path,
      queryParams,
      headersToSign,
      signedHeaderNames.join(';'),
      body
    );

    // Create credential scope
    const credentialScope = `${dateOnlyStr}/${this.region}/${this.service}/request`;

    // Create string to sign
    const stringToSign = await this.createStringToSign(dateStr, credentialScope, canonicalRequest);

    // Calculate signature
    const signature = await this.calculateSignature(dateOnlyStr, stringToSign);

    // Build authorization header
    const authorization = `HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;

    return {
      'Content-Type': 'application/json',
      'Host': host,
      'X-Date': dateStr,
      'X-Content-Sha256': bodyHash,
      'Authorization': authorization,
    };
  }

  /**
   * Format date in ISO8601 basic format (yyyyMMddTHHmmssZ)
   */
  private formatDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  /**
   * Create canonical request string
   */
  private async createCanonicalRequest(
    method: string,
    path: string,
    queryParams: Record<string, string>,
    headers: Record<string, string>,
    signedHeaders: string,
    body: string
  ): Promise<string> {
    // Sort query parameters
    const sortedParams = Object.keys(queryParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
      .join('&');

    // Canonical headers
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map(key => `${key.toLowerCase()}:${headers[key].trim()}`)
      .join('\n') + '\n';

    // Hash the body
    const bodyHash = await this.sha256Hex(body);

    return [
      method,
      path,
      sortedParams,
      canonicalHeaders,
      signedHeaders,
      bodyHash
    ].join('\n');
  }

  /**
   * Create string to sign
   */
  private async createStringToSign(dateStr: string, credentialScope: string, canonicalRequest: string): Promise<string> {
    const canonicalRequestHash = await this.sha256Hex(canonicalRequest);
    return [
      'HMAC-SHA256',
      dateStr,
      credentialScope,
      canonicalRequestHash
    ].join('\n');
  }

  /**
   * Calculate the signature
   */
  private async calculateSignature(dateOnlyStr: string, stringToSign: string): Promise<string> {
    // Derive signing key: kSecret -> kDate -> kRegion -> kService -> kSigning
    const kSecret = new TextEncoder().encode(this.secretAccessKey);
    const kDate = await this.hmacSha256(kSecret, dateOnlyStr);
    const kRegion = await this.hmacSha256(kDate, this.region);
    const kService = await this.hmacSha256(kRegion, this.service);
    const kSigning = await this.hmacSha256(kService, 'request');

    // Calculate final signature
    const signatureBytes = await this.hmacSha256(kSigning, stringToSign);
    return this.bytesToHex(signatureBytes);
  }

  /**
   * Calculate SHA256 hash and return as hex string
   */
  private async sha256Hex(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return this.bytesToHex(new Uint8Array(hashBuffer));
  }

  /**
   * Calculate HMAC-SHA256
   */
  private async hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const msgBuffer = new TextEncoder().encode(message);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgBuffer);
    return new Uint8Array(signature);
  }

  /**
   * Convert bytes to hex string
   */
  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

/**
 * Volcengine Real-time Speech Translation API client
 * Implements the IClient interface for Volcengine's Real-time Speech Translation API
 *
 * API Endpoint: wss://translate.volces.com/api/translate/speech/v1/
 * Authentication: HMAC-SHA256 V4 signature
 * Audio Format: 16kHz, 16-bit, Mono, PCM, Base64 encoded
 */
export class VolcengineSTClient implements IClient {
  private static readonly WEBSOCKET_HOST = 'translate.volces.com';
  private static readonly WEBSOCKET_PATH = '/api/translate/speech/v1/';
  private static readonly API_VERSION = '2020-06-01';
  private static readonly API_ACTION = 'SpeechTranslate';
  private static readonly API_REGION = 'cn-north-1';
  private static readonly API_SERVICE = 'translate';

  private accessKeyId: string;
  private secretAccessKey: string;
  private signer: VolcengineV4Signer;
  private websocket: WebSocket | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private isConnectedState = false;
  private instanceId: string;
  private currentConfig: VolcengineSTSessionConfig | null = null;

  // Track current recognition/translation state
  private currentSequence = 0;
  private pendingSubtitles: Map<number, VolcengineSTSubtitle> = new Map();

  constructor(accessKeyId: string, secretAccessKey: string) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.signer = new VolcengineV4Signer(
      accessKeyId,
      secretAccessKey,
      VolcengineSTClient.API_REGION,
      VolcengineSTClient.API_SERVICE
    );
    this.instanceId = `volcengine_st_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a unique ID for conversation items
   */
  private generateItemId(type: string = 'item'): string {
    return `${this.instanceId}_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate API credentials by making a test TranslateText API call
   */
  static async validateApiKeyAndFetchModels(
    accessKeyId: string,
    secretAccessKey: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    // Text Translation API endpoint
    const API_HOST = 'translate.volcengineapi.com';
    const API_PATH = '/';
    const API_ACTION = 'TranslateText';
    const API_VERSION = '2020-06-01';

    try {
      // Check if credentials are provided
      if (!accessKeyId || !secretAccessKey) {
        return {
          validation: {
            valid: false,
            message: i18n.t('settings.errorValidatingApiKey'),
            validating: false
          },
          models: []
        };
      }

      // Basic format validation
      if (accessKeyId.length < 10 || secretAccessKey.length < 10) {
        return {
          validation: {
            valid: false,
            message: i18n.t('settings.invalidApiKeyFormat'),
            validating: false
          },
          models: []
        };
      }

      // Create signer for HTTP request
      const signer = new VolcengineV4Signer(
        accessKeyId,
        secretAccessKey,
        VolcengineSTClient.API_REGION,
        VolcengineSTClient.API_SERVICE
      );

      // Simple test translation request body
      const requestBody = JSON.stringify({
        SourceLanguage: 'zh',
        TargetLanguage: 'en',
        TextList: ['测试']
      });

      // Generate signed headers
      const signedHeaders = await signer.generateSignedHeaders(
        API_HOST,
        API_PATH,
        'POST',
        API_ACTION,
        API_VERSION,
        requestBody
      );

      // Make the API request
      const response = await fetch(
        `https://${API_HOST}${API_PATH}?Action=${API_ACTION}&Version=${API_VERSION}`,
        {
          method: 'POST',
          headers: signedHeaders,
          body: requestBody,
        }
      );

      const result = await response.json();

      // Check for authentication errors
      if (result.ResponseMetadata?.Error) {
        const error = result.ResponseMetadata.Error;
        console.error('[VolcengineSTClient] API validation error:', error);

        // Authentication error codes (credentials are invalid)
        const authErrorCodes = [
          'AuthFailure',
          'InvalidAccessKeyId',
          'InvalidAccessKey',
          'SignatureDoesNotMatch',
          'AccessDenied',
          'InvalidSecurityToken',
          'ExpiredToken'
        ];

        if (authErrorCodes.includes(error.Code)) {
          return {
            validation: {
              valid: false,
              message: `${i18n.t('settings.errorValidatingApiKey')}: ${error.Message || error.Code}`,
              validating: false
            },
            models: []
          };
        }

        // Service activation errors (credentials valid but service not activated)
        // These errors mean the user needs to activate the service in console
        const serviceErrorCodes = ['-403', '-401'];
        if (serviceErrorCodes.includes(error.Code)) {
          return {
            validation: {
              valid: false,
              message: error.Message || error.Code,
              validating: false
            },
            models: []
          };
        }

        // For any other error, show the error message to the user
        return {
          validation: {
            valid: false,
            message: error.Message || error.Code || i18n.t('settings.errorValidatingApiKey'),
            validating: false
          },
          models: []
        };
      }

      // Success - credentials are valid
      console.log('[VolcengineSTClient] Credentials validated successfully');
      return {
        validation: {
          valid: true,
          message: i18n.t('settings.apiKeyValidationCompleted'),
          validating: false
        },
        models: [
          { id: 'speech-translate-v1', type: 'realtime', created: Date.now() }
        ]
      };
    } catch (error: any) {
      console.error('[VolcengineSTClient] API key validation error:', error);
      return {
        validation: {
          valid: false,
          message: error.message || i18n.t('settings.errorValidatingApiKey'),
          validating: false
        },
        models: []
      };
    }
  }

  async connect(config: SessionConfig): Promise<void> {
    if (config.provider !== 'volcengine_st') {
      throw new Error('Invalid session config for VolcengineST client');
    }

    this.currentConfig = config as VolcengineSTSessionConfig;
    this.conversationItems = [];
    this.currentSequence = 0;
    this.pendingSubtitles.clear();

    return new Promise(async (resolve, reject) => {
      try {
        const signedUrl = await this.signer.generateSignedUrl(
          VolcengineSTClient.WEBSOCKET_HOST,
          VolcengineSTClient.WEBSOCKET_PATH,
          VolcengineSTClient.API_ACTION,
          VolcengineSTClient.API_VERSION
        );

        this.websocket = new WebSocket(signedUrl);

        const CONNECTION_TIMEOUT = 15000;
        const connectionTimer = setTimeout(() => {
          if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
          }
          this.isConnectedState = false;
          reject(new Error('WebSocket connection timeout'));
        }, CONNECTION_TIMEOUT);

        this.websocket.onopen = () => {
          clearTimeout(connectionTimer);
          console.log('[VolcengineSTClient] WebSocket connected');
          this.isConnectedState = true;

          // Send configuration message
          this.sendConfiguration();

          this.eventHandlers.onRealtimeEvent?.({
            source: 'client',
            event: {
              type: 'session.opened',
              data: {
                status: 'connected',
                provider: 'volcengine_st',
                timestamp: Date.now(),
                sourceLanguage: this.currentConfig?.sourceLanguage,
                targetLanguages: this.currentConfig?.targetLanguages,
              }
            }
          });

          this.eventHandlers.onOpen?.();
          resolve();
        };

        this.websocket.onmessage = async (event) => {
          let data: string;
          if (event.data instanceof Blob) {
            data = await event.data.text();
          } else {
            data = event.data;
          }
          this.handleMessage(data);
        };

        this.websocket.onerror = (error) => {
          clearTimeout(connectionTimer);
          console.error('[VolcengineSTClient] WebSocket error:', error);
          this.eventHandlers.onError?.(error);
          reject(error);
        };

        this.websocket.onclose = (event) => {
          clearTimeout(connectionTimer);
          console.log('[VolcengineSTClient] WebSocket closed:', event.code, event.reason);
          this.isConnectedState = false;

          this.eventHandlers.onRealtimeEvent?.({
            source: 'client',
            event: {
              type: 'session.closed',
              data: {
                status: 'disconnected',
                provider: 'volcengine_st',
                timestamp: Date.now(),
                code: event.code,
                reason: event.reason,
              }
            }
          });

          this.eventHandlers.onClose?.(event);
        };
      } catch (error) {
        console.error('[VolcengineSTClient] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Send configuration message to start the session
   */
  private sendConfiguration(): void {
    if (!this.websocket || !this.currentConfig) return;

    const configMessage: VolcengineSTConfigMessage = {
      Configuration: {
        SourceLanguage: this.currentConfig.sourceLanguage,
        TargetLanguages: this.currentConfig.targetLanguages,
        HotWordList: this.currentConfig.hotWordList,
      }
    };

    this.websocket.send(JSON.stringify(configMessage));

    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'configuration.sent',
        data: configMessage
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: {
          type: 'message.received',
          data: message
        }
      });

      // Handle subtitle responses
      if (message.Subtitle) {
        this.handleSubtitle(message.Subtitle);
      }

      // Handle error responses
      if (message.Code && message.Code !== 0) {
        const errorItem: ConversationItem = {
          id: this.generateItemId('error'),
          role: 'system',
          type: 'error',
          status: 'completed',
          formatted: {
            text: `[Error ${message.Code}] ${message.Message || 'Unknown error'}`,
          },
          content: [{
            type: 'text',
            text: message.Message || 'Unknown error'
          }]
        };

        this.conversationItems.push(errorItem);
        this.eventHandlers.onConversationUpdated?.({ item: errorItem });
      }
    } catch (error) {
      console.error('[VolcengineSTClient] Error parsing message:', error, data);
    }
  }

  /**
   * Handle subtitle (translation result) messages
   * Source language subtitles are transcriptions (role: 'user')
   * Target language subtitles are translations (role: 'assistant')
   */
  private handleSubtitle(subtitle: VolcengineSTSubtitle): void {
    // Store or update the subtitle
    this.pendingSubtitles.set(subtitle.Sequence, subtitle);

    // Determine if this is a source transcription or target translation
    const isSourceLanguage = this.currentConfig?.sourceLanguage &&
      subtitle.Language.toLowerCase() === this.currentConfig.sourceLanguage.toLowerCase();
    const role: 'user' | 'assistant' = isSourceLanguage ? 'user' : 'assistant';

    // Create or update conversation item
    const itemId = this.generateItemId(`subtitle_${subtitle.Language}_${subtitle.Sequence}`);

    const conversationItem: ConversationItem = {
      id: itemId,
      role,
      type: 'message',
      status: subtitle.Definite ? 'completed' : 'in_progress',
      createdAt: Date.now(),
      formatted: {
        text: subtitle.Text,
        transcript: subtitle.Text,
      },
      content: [{
        type: 'text',
        text: subtitle.Text
      }]
    };

    // If definite, add to conversation items
    if (subtitle.Definite) {
      this.conversationItems.push(conversationItem);
    }

    this.eventHandlers.onConversationUpdated?.({
      item: conversationItem,
      delta: {
        text: subtitle.Text,
        definite: subtitle.Definite,
        language: subtitle.Language,
        beginTime: subtitle.BeginTime,
        endTime: subtitle.EndTime,
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.websocket) {
      // Send end signal
      const endMessage: VolcengineSTEndMessage = { End: true };
      try {
        this.websocket.send(JSON.stringify(endMessage));
      } catch (e) {
        // Ignore send errors during disconnect
      }

      this.websocket.close();
      this.websocket = null;
    }

    this.isConnectedState = false;

    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.closed',
        data: {
          status: 'disconnected',
          provider: 'volcengine_st',
          timestamp: Date.now(),
          reason: 'client_disconnect'
        }
      }
    });

    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean {
    return this.isConnectedState && this.websocket?.readyState === WebSocket.OPEN;
  }

  updateSession(config: Partial<SessionConfig>): void {
    // Volcengine doesn't support session updates - configuration is set at connection time
    console.warn('[VolcengineSTClient] Session updates are not supported. Reconnect to change configuration.');
  }

  reset(): void {
    this.conversationItems = [];
    this.currentSequence = 0;
    this.pendingSubtitles.clear();
  }

  /**
   * Append input audio data
   * Converts Int16Array to base64-encoded PCM and sends to server
   */
  appendInputAudio(audioData: Int16Array): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.warn('[VolcengineSTClient] Cannot send audio - WebSocket not connected');
      return;
    }

    // Convert Int16Array to base64
    const buffer = new Uint8Array(audioData.buffer, audioData.byteOffset, audioData.byteLength);
    const base64Audio = this.arrayBufferToBase64(buffer);

    const audioMessage: VolcengineSTAudioMessage = {
      AudioData: base64Audio
    };

    this.websocket.send(JSON.stringify(audioMessage));
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Text input is not supported for Volcengine speech translation
   */
  appendInputText(text: string): void {
    console.warn('[VolcengineSTClient] Text input is not supported for speech translation');
  }

  /**
   * Response creation is handled automatically by the server
   */
  createResponse(config?: ResponseConfig): void {
    // Volcengine automatically generates responses when audio is received
    // No manual response creation is needed
  }

  /**
   * Cancel response is not supported
   */
  cancelResponse(trackId?: string, offset?: number): void {
    console.warn('[VolcengineSTClient] Cancel response is not supported');
  }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.VOLCENGINE_ST;
  }
}
