/**
 * Realtime WebSocket Relay with Authentication
 * Based on Cloudflare's openai-workers-relay
 * Supports OpenAI and CometAPI providers
 * Includes authentication verification and usage tracking
 */

import { RealtimeClient } from 'openai-realtime-api';
import { Env } from '../types';

const DEBUG = true; // Set to true for debug logging
const MODEL = 'gpt-4o-realtime-preview-2024-10-01';

// Provider configurations
const PROVIDERS = {
  openai: {
    url: 'wss://api.openai.com/v1/realtime',
    apiKeyEnv: 'OPENAI_API_KEY',
    name: 'OpenAI'
  },
  comet: {
    url: 'wss://api.cometapi.com/v1/realtime',
    apiKeyEnv: 'COMET_API_KEY', 
    name: 'CometAPI'
  }
} as const;

type ProviderType = keyof typeof PROVIDERS;

function relayLog(...args: unknown[]) {
  if (DEBUG) {
    console.log('[realtime-relay]', ...args);
  }
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
    console.error('[realtime-relay error]', message, formatError(error, context), ...additionalArgs);
  } else {
    console.error('[realtime-relay error]', message, ...additionalArgs);
  }
}

async function createRealtimeClient(
  request: Request,
  env: Env,
  userContext?: { userId: string; userEmail?: string }
): Promise<Response> {
  relayLog('Creating realtime client for user:', userContext);
  
  // Track session start time and token usage
  const sessionStartTime = Date.now();
  let totalTokensUsed = 0;
  let sessionId: string | null = null;
  let conversationId: string | null = null;
  
  // Create WebSocket pair
  const webSocketPair = new WebSocketPair();
  const [clientSocket, serverSocket] = Object.values(webSocketPair);

  serverSocket.accept();

  // Get provider from query params, default to OpenAI
  const url = new URL(request.url);
  const providerParam = url.searchParams.get('provider') as ProviderType;
  const provider: ProviderType = providerParam && providerParam in PROVIDERS ? providerParam : 'openai';
  const providerConfig = PROVIDERS[provider];
  
  relayLog('Using provider:', provider, providerConfig.name);
  
  // Handle WebSocket protocol headers
  const responseHeaders = new Headers();
  const protocolHeader = request.headers.get('Sec-WebSocket-Protocol');
  const apiKey = env[providerConfig.apiKeyEnv as keyof Env] as string;
  
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
      provider: providerConfig.name,
      userContext: userContext?.userId ? 'authenticated' : 'unauthenticated'
    });
  }

  if (!apiKey) {
    relayError(`Missing ${providerConfig.name} key. Please set ${providerConfig.apiKeyEnv} in environment variables.`);
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

  // Create RealtimeClient for selected provider
  try {
    relayLog(`Creating ${providerConfig.name} RealtimeClient`);
    realtimeClient = new RealtimeClient({
      apiKey,
      debug: DEBUG,
      url: providerConfig.url,
      model
    });
    relayLog(`${providerConfig.name} RealtimeClient created successfully`);
  } catch (e) {
    relayError(`Error creating ${providerConfig.name} RealtimeClient:`, e);
    serverSocket.close();
    return new Response(`Error creating ${providerConfig.name} RealtimeClient`, {
      status: 500,
    });
  }

  // Relay: Provider -> Client (with usage tracking)
  realtimeClient.realtime.on('server.*', async (event: any) => {
    if (serverSocket.readyState === WebSocket.OPEN) {
      relayLog(`Relaying event from ${providerConfig.name} to client:`, event.type);
      
      // Track token usage for billing if user is authenticated
      if (userContext?.userId) {
        try {
          // Capture session ID and conversation ID from various events
          if (event.type === 'session.created' && event.session?.id) {
            sessionId = event.session.id;
            relayLog('Session created:', { sessionId });
          }
          
          // Capture conversation ID from response events
          if (event.type === 'response.done' && event.response?.conversation_id) {
            conversationId = event.response.conversation_id;
            relayLog('Conversation ID captured from response:', { conversationId });
          }
          
          // Track usage for events that contain token consumption data
          // Based on OpenAI Realtime API documentation:
          // - response.done: Contains comprehensive usage data for each response
          // - conversation.item.input_audio_transcription.completed: Contains usage data for transcription (whisper model)
          // Future events to potentially track: response.audio.done, response.text.done, response.content_part.done
          const eventsWithUsage = [
            'response.done',
            'conversation.item.input_audio_transcription.completed'
          ];
          
          let usage = null;
          let modelName = model; // Use the actual model from request (query param or default)
          let responseId = null;
          
          // Extract usage data based on event type
          if (event.type === 'response.done' && event.response?.usage) {
            usage = event.response.usage;
            modelName = event.response?.model || model; // Use response model or fallback to request model
            responseId = event.response?.id || null;
          } else if (event.type === 'conversation.item.input_audio_transcription.completed' && event.usage) {
            usage = event.usage;
            // For transcription events, use the actual request model (billing should be attributed to main model)
            modelName = model;
            responseId = null; // Transcription events don't have response IDs
            
            // Try to extract conversation_id if available
            if (event.item_id && !conversationId) {
              conversationId = event.item_id.split('_')[0]; // Basic extraction, may need adjustment
            }
          }
          
          // If we have usage data, record it
          if (usage && eventsWithUsage.includes(event.type)) {
            totalTokensUsed += usage.total_tokens || 0;
            
            relayLog('Recording realtime usage:', {
              userId: userContext.userId,
              eventType: event.type,
              totalTokens: usage.total_tokens,
              model: modelName,
              provider: provider
            });
            
            // Get user database ID from clerk_id
            const user = await env.DB.prepare(
              'SELECT id FROM users WHERE clerk_id = ?'
            ).bind(userContext.userId).first();
            
            if (user) {
              // Prepare metadata object with event-specific information
              const metadata: any = {
                provider: provider
              };
              
              // Add event-specific metadata
              if (event.type === 'response.done') {
                if (event.response?.conversation_id) metadata.conversation_id = event.response.conversation_id;
                if (responseId) metadata.response_id = responseId;
                if (event.response?.voice) metadata.voice = event.response.voice;
                if (event.response?.modalities) metadata.modalities = event.response.modalities;
                if (event.response?.temperature) metadata.temperature = event.response.temperature;
              } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
                if (event.item_id) metadata.item_id = event.item_id;
                if (event.transcript) metadata.transcript = event.transcript;
                if (event.content_index !== undefined) metadata.content_index = event.content_index;
                if (conversationId) metadata.conversation_id = conversationId;
              }
              
              // Record usage in database with new schema
              await env.DB.prepare(`
                INSERT INTO usage_logs (
                  user_id, event_type, event_id, session_id, model, provider,
                  total_tokens, input_tokens, output_tokens,
                  input_token_details, output_token_details, usage_data, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                user.id,
                event.type,
                event.event_id || null,
                sessionId || null,
                modelName,
                provider,
                usage.total_tokens || 0,
                usage.input_tokens || 0,
                usage.output_tokens || 0,
                JSON.stringify(usage.input_token_details || {}),
                JSON.stringify(usage.output_token_details || {}),
                JSON.stringify(usage),
                JSON.stringify(metadata)
              ).run();
            }
            
            // Update user's total token usage
            if (user) {
              await env.DB.prepare(`
                UPDATE users 
                SET tokens_used = tokens_used + ?, 
                    updated_at = datetime('now')
                WHERE id = ?
              `).bind(usage.total_tokens || 0, user.id).run();
            }
          }
        } catch (billingError) {
          relayError('Error recording usage:', billingError);
          // Don't interrupt the relay for billing errors
        }
      }
      
      serverSocket.send(JSON.stringify(event));
    }
  });

  realtimeClient.realtime.on('close', (event: any) => {
    const error = event?.error || false;
    relayLog(`${providerConfig.name} connection closed (error: ${error})`);
    // Close downstream connection when upstream closes
    try {
      serverSocket.close(error ? 1011 : 1000, 'Upstream closed');
    } catch (e) {
      relayLog('Error closing serverSocket on upstream close:', e);
    }
  });

  // Relay: Client -> Provider
  const messageQueue: string[] = [];

  // Message handler function - moved outside event listener for reuse
  const messageHandler = (data: string) => {
    try {
      const parsedEvent = JSON.parse(data);
      relayLog(`Relaying event from client to ${providerConfig.name}:`, parsedEvent.type);
      realtimeClient!.realtime.send(parsedEvent.type, parsedEvent);
    } catch (e) {
      relayError('Error parsing event from client:', e, 'Data:', data);
    }
  };

  serverSocket.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : event.data.toString();
    
    if (!realtimeClient.isConnected) {
      relayLog(`${providerConfig.name} not connected yet, queuing message`);
      messageQueue.push(data);
    } else {
      messageHandler(data);
    }
  });

  serverSocket.addEventListener('close', async (evt: CloseEvent) => {
    const codeDescription = WEBSOCKET_CLOSE_CODES[evt.code as keyof typeof WEBSOCKET_CLOSE_CODES] || 'Unknown';
    const closeInfo = `Code: ${evt.code} (${codeDescription}), Reason: ${evt.reason || 'No reason'}, WasClean: ${evt.wasClean}`;
    relayLog(`Client closed connection: ${closeInfo}`);
    
    // Log session duration if user is authenticated
    if (userContext?.userId) {
      const sessionDuration = Math.round((Date.now() - sessionStartTime) / 1000);
      relayLog('Session ended for user:', {
        userId: userContext.userId,
        duration: `${sessionDuration}s`,
        totalTokens: totalTokensUsed
      });
    }
    
    // CRITICAL FIX: Must close serverSocket to prevent hung request
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
    // If WebSocket is already closed, this is likely a normal cleanup event, not a real error
    if (serverSocket.readyState === WebSocket.CLOSED) {
      relayLog('WebSocket error event after close (likely cleanup)', {
        state: WEBSOCKET_STATES[serverSocket.readyState as keyof typeof WEBSOCKET_STATES],
        user: userContext?.userId || 'anonymous'
      });
      return; // Don't log as error
    }
    
    // Real error situation - WebSocket is in CONNECTING, OPEN, or CLOSING state
    const wsState = WEBSOCKET_STATES[serverSocket.readyState as keyof typeof WEBSOCKET_STATES] || 'UNKNOWN';
    const context = `WebSocket State: ${wsState} (${serverSocket.readyState}), User: ${userContext?.userId || 'anonymous'}`;
    relayError('Client socket error:', err, context);
    try { 
      serverSocket.close(1011, 'Client socket error'); 
    } catch {}
    try { 
      realtimeClient?.disconnect(); 
    } catch {}
  });

  // Connect to Provider Realtime API asynchronously (don't block 101 response)
  (async () => {
    try {
      relayLog(`Connecting to ${providerConfig.name} with model: ${model}...`);
      await realtimeClient.connect();
      relayLog(`Connected to ${providerConfig.name} successfully!`);
      
      // Process any queued messages - FIX: use messageHandler instead of serverSocket.send
      while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        if (message) {
          relayLog('Processing queued message');
          messageHandler(message); // Forward to provider, not back to client
        }
      }
    } catch (e) {
      relayError(`Error connecting to ${providerConfig.name}:`, e, `User: ${userContext?.userId || 'anonymous'}`);
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

export default {
  async fetch(request: Request, env: Env, userContext?: { userId: string; userEmail?: string }): Promise<Response> {
    // Only handle WebSocket upgrade requests
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    relayLog('Received WebSocket upgrade request from user:', userContext);
    return createRealtimeClient(request, env, userContext);
  },
};