/**
 * CometAPI Realtime WebSocket Relay with Authentication
 * Based on Cloudflare's openai-workers-relay
 * Includes authentication verification and usage tracking
 */

import { RealtimeClient } from 'openai-realtime-api';
import { Env } from '../types';

const DEBUG = true; // Set to true for debug logging
const MODEL = 'gpt-4o-realtime-preview-2024-10-01';
const COMET_API_URL = 'wss://api.cometapi.com/v1/realtime';

function relayLog(...args: unknown[]) {
  if (DEBUG) {
    console.log('[experimental-relay]', ...args);
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
    console.error('[experimental-relay error]', message, formatError(error, context), ...additionalArgs);
  } else {
    console.error('[experimental-relay error]', message, ...additionalArgs);
  }
}

async function createExperimentalRealtimeClient(
  request: Request,
  env: Env,
  userContext?: { userId: string; userEmail?: string }
): Promise<Response> {
  relayLog('Creating experimental realtime client for user:', userContext);
  
  // Track session start time and token usage
  const sessionStartTime = Date.now();
  let totalTokensUsed = 0;
  let sessionId: string | null = null;
  let conversationId: string | null = null;
  
  // Create WebSocket pair
  const webSocketPair = new WebSocketPair();
  const [clientSocket, serverSocket] = Object.values(webSocketPair);

  serverSocket.accept();

  // Handle WebSocket protocol headers
  const responseHeaders = new Headers();
  const protocolHeader = request.headers.get('Sec-WebSocket-Protocol');
  const apiKey = env.COMET_API_KEY;
  
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
      userContext: userContext?.userId ? 'authenticated' : 'unauthenticated'
    });
  }

  if (!apiKey) {
    relayError('Missing CometAPI key. Please set COMET_API_KEY in environment variables.');
    serverSocket.close(1008, 'Missing API key');
    return new Response('Missing API key', { status: 401 });
  }

  // Get model from query params or use default
  let model: string = MODEL;
  const modelParam = new URL(request.url).searchParams.get('model');
  if (modelParam) {
    model = modelParam;
    relayLog('Using model from query params:', model);
  }

  let realtimeClient: RealtimeClient | null = null;

  // Create RealtimeClient for CometAPI
  try {
    relayLog('Creating CometAPI RealtimeClient');
    realtimeClient = new RealtimeClient({
      apiKey,
      debug: DEBUG,
      url: COMET_API_URL,
      model
    });
    relayLog('CometAPI RealtimeClient created successfully');
  } catch (e) {
    relayError('Error creating CometAPI RealtimeClient:', e);
    serverSocket.close();
    return new Response('Error creating CometAPI RealtimeClient', {
      status: 500,
    });
  }

  // Relay: CometAPI -> Client (with usage tracking)
  realtimeClient.realtime.on('server.*', async (event: any) => {
    if (serverSocket.readyState === WebSocket.OPEN) {
      relayLog('Relaying event from CometAPI to client:', event.type);
      
      // Track token usage for billing if user is authenticated
      if (userContext?.userId) {
        try {
          // Capture session ID from session.created event
          if (event.type === 'session.created' && event.session?.id) {
            sessionId = event.session.id;
            relayLog('Session created:', { sessionId });
          }
          
          // Track usage for specific event types that consume tokens
          if (event.type === 'response.done' && event.response?.usage) {
            const usage = event.response.usage;
            totalTokensUsed += usage.total_tokens || 0;
            
            relayLog('Recording realtime usage:', {
              userId: userContext.userId,
              totalTokens: usage.total_tokens,
              model: event.response.model || 'gpt-4o-realtime-preview'
            });
            
            // Get user database ID from clerk_id
            const user = await env.DB.prepare(
              'SELECT id FROM users WHERE clerk_id = ?'
            ).bind(userContext.userId).first();
            
            if (user) {
              // Record usage in database with correct schema
              await env.DB.prepare(`
                INSERT INTO usage_logs (
                  user_id, session_id, response_id, model, 
                  total_tokens, input_tokens, output_tokens,
                  input_token_details, output_token_details, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                user.id,
                sessionId || null, // We'll need to track session ID
                event.response?.id || null,
                event.response?.model || 'gpt-4o-realtime-preview',
                usage.total_tokens || 0,
                usage.input_tokens || 0,
                usage.output_tokens || 0,
                JSON.stringify(usage.input_token_details || {}),
                JSON.stringify(usage.output_token_details || {}),
                JSON.stringify({ 
                  provider: 'comet',
                  conversation_id: conversationId || null,
                  event_type: event.type 
                })
              ).run();
            }
            
            // Update user's total token usage (optional, since we calculate from usage_logs in real-time)
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
    relayLog(`CometAPI connection closed (error: ${error})`);
    // Close downstream connection when upstream closes
    try {
      serverSocket.close(error ? 1011 : 1000, 'Upstream closed');
    } catch (e) {
      relayLog('Error closing serverSocket on upstream close:', e);
    }
  });

  // Relay: Client -> CometAPI
  const messageQueue: string[] = [];

  // Message handler function - moved outside event listener for reuse
  const messageHandler = (data: string) => {
    try {
      const parsedEvent = JSON.parse(data);
      relayLog('Relaying event from client to CometAPI:', parsedEvent.type);
      realtimeClient!.realtime.send(parsedEvent.type, parsedEvent);
    } catch (e) {
      relayError('Error parsing event from client:', e, 'Data:', data);
    }
  };

  serverSocket.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : event.data.toString();
    
    if (!realtimeClient.isConnected) {
      relayLog('CometAPI not connected yet, queuing message');
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

  // Connect to CometAPI Realtime API asynchronously (don't block 101 response)
  (async () => {
    try {
      relayLog(`Connecting to CometAPI with model: ${model}...`);
      await realtimeClient.connect();
      relayLog('Connected to CometAPI successfully!');
      
      // Process any queued messages - FIX: use messageHandler instead of serverSocket.send
      while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        if (message) {
          relayLog('Processing queued message');
          messageHandler(message); // Forward to CometAPI, not back to client
        }
      }
    } catch (e) {
      relayError('Error connecting to CometAPI:', e, `User: ${userContext?.userId || 'anonymous'}`);
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
    return createExperimentalRealtimeClient(request, env, userContext);
  },
};