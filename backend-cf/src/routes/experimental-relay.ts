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

function relayError(...args: unknown[]) {
  console.error('[experimental-relay error]', ...args);
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
          // Track usage for specific event types that consume tokens
          if (event.type === 'response.done' && event.response?.usage) {
            const usage = event.response.usage;
            totalTokensUsed += usage.total_tokens || 0;
            
            relayLog('Recording realtime usage:', {
              userId: userContext.userId,
              totalTokens: usage.total_tokens,
              model: event.response.model || 'gpt-4o-realtime-preview'
            });
            
            // Record usage in database
            await env.DB.prepare(`
              INSERT INTO usage_logs (user_id, model, provider, tokens, metadata, created_at)
              VALUES (?, ?, 'comet', ?, ?, datetime('now'))
            `).bind(
              userContext.userId,
              event.response.model || 'gpt-4o-realtime-preview',
              usage.total_tokens || 0,
              JSON.stringify(usage)
            ).run();
            
            // Update user's total token usage
            await env.DB.prepare(`
              UPDATE users 
              SET tokens_used = tokens_used + ?, 
                  updated_at = datetime('now')
              WHERE clerk_id = ?
            `).bind(usage.total_tokens || 0, userContext.userId).run();
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
    relayLog(`Client closed connection: ${evt.code} ${evt.reason}`);
    
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
    relayError('Client socket error:', err);
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
      relayError('Error connecting to CometAPI:', e);
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