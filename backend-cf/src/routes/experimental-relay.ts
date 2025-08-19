/**
 * Experimental CometAPI Realtime WebSocket Relay
 * Based on Cloudflare's openai-workers-relay
 * Direct WebSocket relay without authentication or billing
 * For development and testing purposes only
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
  env: Env
): Promise<Response> {
  relayLog('Creating experimental realtime client');
  
  // Create WebSocket pair
  const webSocketPair = new WebSocketPair();
  const [clientSocket, serverSocket] = Object.values(webSocketPair);

  serverSocket.accept();

  // Copy protocol headers
  const responseHeaders = new Headers();
  const protocolHeader = request.headers.get('Sec-WebSocket-Protocol');
  const apiKey = env.COMET_API_KEY;
  
  if (protocolHeader) {
    const requestedProtocols = protocolHeader.split(',').map((p) => p.trim());
    if (requestedProtocols.includes('realtime')) {
      // Accept the realtime protocol
      responseHeaders.set('Sec-WebSocket-Protocol', 'realtime');
    }
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

  // Relay: CometAPI -> Client
  realtimeClient.realtime.on('server.*', (event: { type: string }) => {
    if (serverSocket.readyState === WebSocket.OPEN) {
      relayLog('Relaying event from CometAPI to client:', event.type);
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

  serverSocket.addEventListener('close', (evt: CloseEvent) => {
    relayLog(`Client closed connection: ${evt.code} ${evt.reason}`);
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
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only handle WebSocket upgrade requests
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    relayLog('Received WebSocket upgrade request');
    return createExperimentalRealtimeClient(request, env);
  },
};