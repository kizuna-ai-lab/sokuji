/**
 * Realtime WebSocket Relay Durable Object
 * Handles WebSocket connections for real-time AI translation with OpenAI
 * Includes authentication verification and wallet token deduction
 */

import { DurableObject } from 'cloudflare:workers';
import { RealtimeClient } from 'openai-realtime-api';
import { createWalletService } from '../services/wallet-service';
import type { CloudflareBindings } from "../env";

// Type alias for compatibility
type Env = CloudflareBindings & {
  DB: D1Database;
  WALLET_CACHE?: KVNamespace;
  OPENAI_API_KEY: string;
};

const DEBUG = false; // Set to true for debug logging
const MODEL = 'gpt-4o-mini-realtime-preview';

// OpenAI configuration
const OPENAI_CONFIG = {
  url: 'wss://api.openai.com/v1/realtime',
  apiKeyEnv: 'OPENAI_API_KEY',
  name: 'OpenAI'
} as const;

function relayLog(...args: unknown[]) {
  console.log('[realtime-relay-do]', ...args);
}

const WEBSOCKET_STATES = {
  0: 'CONNECTING',
  1: 'OPEN', 
  2: 'CLOSING',
  3: 'CLOSED'
} as const;

const WEBSOCKET_CLOSE_CODES = {
  1000: 'Normal Closure',
  1001: 'Going Away', 
  1002: 'Protocol Error',
  1003: 'Unsupported Data',
  1005: 'No Status Received',
  1006: 'Abnormal Closure',
  1011: 'Internal Error',
  1015: 'TLS Handshake'
} as const;

function formatError(error: unknown, context?: string): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\nStack: ${error.stack}${context ? `\nContext: ${context}` : ''}`;
  }
  if (typeof error === 'object' && error !== null) {
    try {
      const jsonStr = JSON.stringify(error, null, 2);
      if (jsonStr === '{}' || jsonStr === 'null') {
        return `Empty error object${context ? ` (Context: ${context})` : ''}`;
      }
      return `${jsonStr}${context ? `\nContext: ${context}` : ''}`;
    } catch {
      return `${String(error)}${context ? ` (Context: ${context})` : ''}`;
    }
  }
  return `${String(error)}${context ? ` (Context: ${context})` : ''}`;
}

function relayError(message: string, error?: unknown, context?: string, ...additionalArgs: unknown[]) {
  if (error !== undefined) {
    console.error('[realtime-relay-do error]', message, formatError(error, context), ...additionalArgs);
  } else {
    console.error('[realtime-relay-do error]', message, ...additionalArgs);
  }
}

interface SessionState {
  userId: string;
  userEmail?: string;
  sessionId?: string;
  conversationId?: string;
  sessionStartTime: number;
  totalTokensUsed: number;
  model: string;
  clientSocket?: WebSocket;
  realtimeClient?: RealtimeClient;
  walletBalance?: number; // Cache balance in session state
}

export class RealtimeRelayDurableObject extends DurableObject {
  private sessions: Map<string, SessionState> = new Map();
  private walletService?: ReturnType<typeof createWalletService>;
  private walletCache: Map<string, { balance: any; timestamp: number }> = new Map();
  private static readonly WALLET_CACHE_TTL = 60000; // 1 minute cache for session

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Initialize wallet service with batching enabled for realtime sessions
    this.walletService = createWalletService(this.env as Env, true);
  }

  async fetch(request: Request): Promise<Response> {
    // Only handle WebSocket upgrade requests
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    // Extract user context from headers (passed from the main worker)
    const userId = request.headers.get('X-User-Id');
    const userEmail = request.headers.get('X-User-Email') || undefined;

    if (!userId) {
      return new Response('Missing user context', { status: 401 });
    }

    relayLog('Received WebSocket upgrade request from user:', { userId, userEmail });

    return this.handleWebSocketConnection(request, userId, userEmail);
  }

  private async handleWebSocketConnection(
    request: Request, 
    userId: string, 
    userEmail?: string
  ): Promise<Response> {
    relayLog('Creating realtime client for user:', { userId, userEmail });

    // Track session start time and token usage
    const sessionStartTime = Date.now();
    let totalTokensUsed = 0;
    let sessionId: string | null = null;
    let conversationId: string | null = null;

    // Create WebSocket pair
    const webSocketPair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(webSocketPair);

    serverSocket.accept();

    // Use the Durable Object's wallet service instance
    const walletService = this.walletService || createWalletService(this.env as Env, true);

    // Use optimized getOrCreateWallet to combine existence check and balance retrieval
    const walletBalance = await walletService.getOrCreateWallet('user', userId, 'free_plan');
    relayLog(`Got/created wallet for user ${userId}, balance: ${walletBalance?.balanceTokens}`);

    if (walletBalance) {
      // Check if wallet is frozen
      if (walletBalance.frozen) {
        relayError(`Wallet is frozen for user ${userId}`);
        const errorMessage = {
          type: 'error',
          error: {
            type: 'wallet_frozen',
            message: 'Your wallet is frozen. Please contact support.',
            code: 'wallet_frozen'
          }
        };
        serverSocket.send(JSON.stringify(errorMessage));
        serverSocket.close(1008, 'Wallet is frozen');
        return new Response('Wallet is frozen', { status: 403 });
      }

      // Check if balance is insufficient (less than 0)
      if (walletBalance.balanceTokens < 0) {
        relayError(`Insufficient balance for user ${userId}: ${walletBalance.balanceTokens} tokens`);
        const errorMessage = {
          type: 'error',
          error: {
            type: 'insufficient_balance',
            message: `Insufficient token balance. Current balance: ${walletBalance.balanceTokens} tokens (negative balance).`,
            code: 'insufficient_balance',
            balance: walletBalance.balanceTokens
          }
        };
        serverSocket.send(JSON.stringify(errorMessage));
        serverSocket.close(1008, 'Insufficient balance');
        return new Response('Insufficient balance', { status: 402 });
      }

      relayLog(`Wallet balance check passed for user ${userId}: ${walletBalance.balanceTokens} tokens`);
    } else {
      relayLog(`Warning: Could not get wallet balance for user ${userId}, proceeding anyway`);
    }

    const url = new URL(request.url);

    relayLog('Using OpenAI provider');

    // Handle WebSocket protocol headers
    const responseHeaders = new Headers();
    const protocolHeader = request.headers.get('Sec-WebSocket-Protocol');
    const apiKey = (this.env as Env)[OPENAI_CONFIG.apiKeyEnv as keyof Env] as string;

    if (protocolHeader) {
      const requestedProtocols = protocolHeader.split(',').map((p) => p.trim());

      // Filter out the authentication protocol (openai-insecure-api-key.*)
      // and only keep the actual WebSocket sub-protocols
      const filteredProtocols = requestedProtocols.filter(p => 
        !p.startsWith('openai-insecure-api-key.') && 
        !p.startsWith('openai-beta.')
      );

      // Accept the realtime protocol if requested
      if (filteredProtocols.includes('realtime')) {
        responseHeaders.set('Sec-WebSocket-Protocol', 'realtime');
      }

      relayLog('WebSocket protocols:', {
        requested: requestedProtocols,
        filtered: filteredProtocols,
        provider: 'OpenAI',
        userContext: 'authenticated'
      });
    }

    if (!apiKey) {
      relayError(`Missing OpenAI API key. Please set OPENAI_API_KEY in environment variables.`);
      serverSocket.close(1008, 'Missing API key');
      return new Response('Missing API key', { status: 401 });
    }

    // Get model from query params or use default
    let model: string = MODEL;
    const modelParam = url.searchParams.get('model');
    if (modelParam) {
      model = modelParam;
      relayLog('Using model from query params:', model);
    }

    let realtimeClient: RealtimeClient | null = null;

    // Create OpenAI RealtimeClient
    try {
      relayLog('Creating OpenAI RealtimeClient');
      realtimeClient = new RealtimeClient({
        apiKey,
        debug: DEBUG,
        url: OPENAI_CONFIG.url,
        model
      });
      relayLog('OpenAI RealtimeClient created successfully');
    } catch (e) {
      relayError('Error creating OpenAI RealtimeClient:', e);
      serverSocket.close();
      return new Response('Error creating OpenAI RealtimeClient', {
        status: 500,
      });
    }

    // Store session state
    const sessionKey = `${userId}_${Date.now()}`;
    const sessionState: SessionState = {
      userId,
      userEmail,
      sessionStartTime,
      totalTokensUsed,
      model,
      clientSocket,
      realtimeClient
    };
    this.sessions.set(sessionKey, sessionState);

    // Relay: OpenAI -> Client (with usage tracking)
    realtimeClient.realtime.on('server.*', async (event: any) => {
      if (serverSocket.readyState === WebSocket.OPEN) {
        // Skip logging for events with binary audio data
        const skipLogging = event.type === 'response.audio.delta' || 
                            event.type === 'response.audio_transcript.delta' ||
                            event.type === 'input_audio_buffer.speech_started' ||
                            event.type === 'input_audio_buffer.speech_stopped' ||
                            event.type === 'conversation.item.input_audio_transcription.in_progress';

        if (!skipLogging) {
          relayLog('Relaying event from OpenAI to client:', event.type);
        }

        // Track token usage for billing
        await this.handleTokenUsage(event, sessionState, walletService, serverSocket);

        serverSocket.send(JSON.stringify(event));
      }
    });

    realtimeClient.realtime.on('close', (event: any) => {
      const error = event?.error || false;
      relayLog(`OpenAI connection closed (error: ${error})`);
      // Close downstream connection when upstream closes
      try {
        serverSocket.close(error ? 1011 : 1000, 'Upstream closed');
      } catch (e) {
        relayLog('Error closing serverSocket on upstream close:', e);
      }
    });

    // Relay: Client -> Provider
    const messageQueue: string[] = [];

    // Message handler function
    const messageHandler = (data: string) => {
      try {
        const parsedEvent = JSON.parse(data);
        // Skip logging for events with audio data
        const skipLogging = parsedEvent.type === 'input_audio_buffer.append' ||
                            parsedEvent.type === 'response.create';

        if (!skipLogging) {
          relayLog('Relaying event from client to OpenAI:', parsedEvent.type);
        }
        realtimeClient!.realtime.send(parsedEvent.type, parsedEvent);
      } catch (e) {
        relayError('Error parsing event from client:', e, 'Data length:', data.length);
      }
    };

    serverSocket.addEventListener('message', (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : event.data.toString();

      if (!realtimeClient.isConnected) {
        relayLog('OpenAI not connected yet, queuing message');
        messageQueue.push(data);
      } else {
        messageHandler(data);
      }
    });

    serverSocket.addEventListener('close', async (evt: CloseEvent) => {
      const codeDescription = WEBSOCKET_CLOSE_CODES[evt.code as keyof typeof WEBSOCKET_CLOSE_CODES] || 'Unknown';
      const closeInfo = `Code: ${evt.code} (${codeDescription}), Reason: ${evt.reason || 'No reason'}, WasClean: ${evt.wasClean}`;
      relayLog(`Client closed connection: ${closeInfo}`);

      // Log session duration
      const sessionDuration = Math.round((Date.now() - sessionStartTime) / 1000);
      relayLog('Session ended for user:', {
        userId,
        duration: `${sessionDuration}s`,
        totalTokens: sessionState.totalTokensUsed
      });

      // Clean up session state
      this.sessions.delete(sessionKey);
      
      // Flush any buffered usage logs for this session
      if (this.walletService) {
        try {
          await this.walletService.flushUsageBuffer();
          relayLog('Flushed usage buffer for session cleanup');
        } catch (e) {
          relayLog('Error flushing usage buffer:', e);
        }
      }

      // Close connections
      try { 
        serverSocket.close();
      } catch (e) {
        relayLog('Error closing serverSocket:', e);
      }
      try { 
        realtimeClient?.disconnect(); 
      } catch (e) {
        relayLog('Error disconnecting realtimeClient:', e);
      }
      messageQueue.length = 0;
    });

    // Add error handler for serverSocket
    serverSocket.addEventListener('error', (err) => {
      // If WebSocket is already closed, this is likely a normal cleanup event
      if (serverSocket.readyState === WebSocket.CLOSED) {
        relayLog('WebSocket error event after close (likely cleanup)', {
          state: WEBSOCKET_STATES[serverSocket.readyState as keyof typeof WEBSOCKET_STATES],
          user: userId
        });
        return;
      }

      // Real error situation
      const wsState = WEBSOCKET_STATES[serverSocket.readyState as keyof typeof WEBSOCKET_STATES] || 'UNKNOWN';
      const context = `WebSocket State: ${wsState} (${serverSocket.readyState}), User: ${userId}`;
      relayError('Client socket error:', err, context);
      try { 
        serverSocket.close(1011, 'Client socket error'); 
      } catch {}
      try { 
        realtimeClient?.disconnect(); 
      } catch {}
    });

    // Connect to OpenAI Realtime API asynchronously
    (async () => {
      try {
        relayLog(`Connecting to OpenAI with model: ${model}...`);
        await realtimeClient.connect();
        relayLog('Connected to OpenAI successfully!');

        // Process any queued messages
        while (messageQueue.length > 0) {
          const message = messageQueue.shift();
          if (message) {
            relayLog('Processing queued message');
            messageHandler(message);
          }
        }
      } catch (e) {
        relayError('Error connecting to OpenAI:', e, `User: ${userId}`);
        // Close the connection on upstream connect failure
        try {
          serverSocket.close(1011, 'Upstream connect failed');
        } catch {}
      }
    })();

    relayLog('WebSocket relay established, connecting to upstream...');

    // Return the client socket as the response immediately
    return new Response(null, {
      status: 101,
      headers: responseHeaders,
      webSocket: clientSocket,
    });
  }

  private async handleTokenUsage(
    event: any,
    sessionState: SessionState,
    walletService: any,
    serverSocket: WebSocket
  ) {
    try {
      // Capture session ID and conversation ID from various events
      if (event.type === 'session.created' && event.session?.id) {
        sessionState.sessionId = event.session.id;
        relayLog('Session created:', { sessionId: sessionState.sessionId });
      }

      // Capture conversation ID from response events
      if (event.type === 'response.done' && event.response?.conversation_id) {
        sessionState.conversationId = event.response.conversation_id;
        relayLog('Conversation ID captured from response:', { conversationId: sessionState.conversationId });
      }

      // Track usage for events that contain token consumption data
      const eventsWithUsage = [
        'response.done',
        'conversation.item.input_audio_transcription.completed'
      ];

      let usage = null;
      let modelName = sessionState.model;
      let responseId = null;

      // Extract usage data based on event type
      if (event.type === 'response.done' && event.response?.usage) {
        usage = event.response.usage;
        modelName = event.response?.model || sessionState.model;
        responseId = event.response?.id || null;
      } else if (event.type === 'conversation.item.input_audio_transcription.completed' && event.usage) {
        usage = event.usage;
        modelName = sessionState.model;
        responseId = null;

        // Try to extract conversation_id if available
        if (event.item_id && !sessionState.conversationId) {
          sessionState.conversationId = event.item_id.split('_')[0];
        }
      }

      // If we have usage data, deduct tokens from wallet
      if (usage && eventsWithUsage.includes(event.type)) {
        let inputTokens = 0;
        let outputTokens = 0;
        let durationSeconds: number | undefined;

        // Check if this is duration-based usage (transcription)
        if (usage.type === 'duration' && usage.seconds !== undefined) {
          durationSeconds = usage.seconds;
          relayLog('Duration-based usage detected:', {
            eventType: event.type,
            durationSeconds,
            model: modelName
          });
        } else {
          // Token-based billing
          inputTokens = usage.input_tokens || 0;
          outputTokens = usage.output_tokens || 0;
        }

        // Determine modality
        let modality: 'audio' | 'text' | 'transcription' = 'audio';

        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          modality = 'transcription';
        } else if (event.response?.modalities && Array.isArray(event.response.modalities)) {
          if (event.response.modalities.length === 1 && event.response.modalities[0] === 'text') {
            modality = 'text';
          }
        }

        // Track total tokens
        if (!durationSeconds) {
          sessionState.totalTokensUsed += inputTokens + outputTokens;
        }

        relayLog('Processing usage:', {
          userId: sessionState.userId,
          eventType: event.type,
          model: modelName,
          provider: 'openai',
          modality: modality,
          inputTokens,
          outputTokens,
          durationSeconds,
          totalTokens: inputTokens + outputTokens
        });

        // Prepare metadata
        const metadata: any = {
          event_id: event.event_id || null,
          usage_details: usage,
          modality: modality
        };

        // Add event-specific metadata
        if (event.type === 'response.done') {
          if (event.response?.conversation_id) metadata.conversation_id = event.response.conversation_id;
          if (event.response?.voice) metadata.voice = event.response.voice;
          if (event.response?.modalities) metadata.modalities = event.response.modalities;
          if (event.response?.temperature) metadata.temperature = event.response.temperature;
        } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
          if (event.item_id) metadata.item_id = event.item_id;
          if (event.transcript) metadata.transcript_length = event.transcript?.length || 0;
          if (event.content_index !== undefined) metadata.content_index = event.content_index;
          if (sessionState.conversationId) metadata.conversation_id = sessionState.conversationId;
          if (durationSeconds !== undefined) {
            metadata.duration_seconds = durationSeconds;
            metadata.billing_type = 'duration';
          }
        }

        // Deduct tokens from wallet (with batched logging for realtime sessions)
        const deductResult = await walletService.useTokens({
          subjectType: 'user',
          subjectId: sessionState.userId,
          provider: 'openai',
          model: modelName,
          endpoint: '/v1/realtime',
          method: 'WS',
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          durationSeconds: durationSeconds,
          modality: modality,
          sessionId: sessionState.sessionId,
          responseId: responseId || undefined,
          eventType: event.type,
          metadata: metadata,
          batchLogging: true  // Enable batching for realtime session usage logs
        });

        if (!deductResult.success) {
          relayError('Failed to deduct tokens from wallet:', deductResult.error, `User: ${sessionState.userId}`);

          // Send error message to client and close connection if insufficient balance or frozen
          if (deductResult.error === 'Insufficient balance' || deductResult.error === 'Wallet is frozen') {
            const errorMessage = {
              type: 'error',
              error: {
                type: 'insufficient_balance',
                message: deductResult.error === 'Insufficient balance' 
                  ? `Insufficient token balance. Remaining: ${deductResult.remaining || 0} tokens`
                  : 'Your wallet is frozen. Please contact support.',
                code: deductResult.error === 'Insufficient balance' ? 'insufficient_balance' : 'wallet_frozen'
              }
            };

            serverSocket.send(JSON.stringify(errorMessage));

            // Close the connection after sending error
            setTimeout(() => {
              serverSocket.close(1008, deductResult.error);
              sessionState.realtimeClient?.disconnect();
            }, 100);

            return;
          }
        } else {
          relayLog('Tokens deducted successfully:', {
            remaining: deductResult.remaining,
            tokensUsed: deductResult.deducted || 0
          });
        }
      }
    } catch (billingError) {
      relayError('Error recording usage:', billingError);
      // Don't interrupt the relay for billing errors
    }
  }
}