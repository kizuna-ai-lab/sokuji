/**
 * OpenAI Realtime API WebSocket Proxy
 * A simplified proxy based on Cloudflare's openai-workers-relay
 * Handles WebSocket connections transparently with authentication and billing
 */

import { RealtimeClient } from '@openai/realtime-api-beta';
import { Env } from '../types';
import { verifyClerkToken } from '../services/clerk';

/**
 * Extract authentication from request
 * Supports both Authorization header and WebSocket subprotocol
 */
async function extractAuth(request: Request, env: Env) {
  // Try Authorization header first
  const authorization = request.headers.get('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.substring(7);
    const result = await verifyClerkToken(token, env);
    if (result.valid && result.userId) {
      return {
        sub: result.userId,
        email: result.email
      };
    }
  }
  
  // For WebSocket, check Sec-WebSocket-Protocol
  // OpenAI client sends: "realtime,openai-insecure-api-key.{token},openai-beta.realtime-v1"
  const protocols = request.headers.get('Sec-WebSocket-Protocol');
  if (protocols) {
    const protocolList = protocols.split(',').map(p => p.trim());
    for (const protocol of protocolList) {
      if (protocol.startsWith('openai-insecure-api-key.')) {
        const token = protocol.substring('openai-insecure-api-key.'.length);
        const result = await verifyClerkToken(token, env);
        if (result.valid && result.userId) {
          return {
            sub: result.userId,
            email: result.email
          };
        }
      }
    }
  }
  
  return null;
}

/**
 * Log usage for billing purposes with timeout protection
 */
async function logRealtimeUsage(clerkId: string, model: string, env: Env): Promise<void> {
  return Promise.race([
    (async () => {
      try {
        // Get the internal user_id from clerk_id
        const userResult = await env.DB.prepare(`
          SELECT id FROM users WHERE clerk_id = ?
        `).bind(clerkId).first();
        
        if (!userResult) {
          console.error('User not found in database for clerk_id:', clerkId);
          return;
        }

        await env.DB.prepare(`
          INSERT INTO usage_logs (user_id, model, provider, tokens, created_at)
          VALUES (?, ?, 'openai', 0, datetime('now'))
        `).bind(userResult.id, model).run();
      } catch (error) {
        console.error('Failed to log usage:', error);
      }
    })(),
    new Promise<void>((_, reject) => 
      setTimeout(() => reject(new Error('Database operation timeout')), 5000)
    )
  ]).catch(error => {
    console.error('Database logging failed or timed out:', error);
  });
}

/**
 * Main WebSocket proxy handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Check if this is a WebSocket upgrade request
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { 
        status: 426,
        headers: {
          'Content-Type': 'text/plain',
        }
      });
    }

    // Verify authentication
    const user = await extractAuth(request, env);
    if (!user) {
      return new Response('Unauthorized', { 
        status: 401,
        headers: {
          'Content-Type': 'text/plain',
        }
      });
    }

    // Extract model from URL parameters
    const url = new URL(request.url);
    const model = url.searchParams.get('model') || 'gpt-4o-realtime-preview-2024-12-17';
    
    // Create WebSocketPair for client connection
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept the WebSocket connection
    server.accept();

    // Handle the relay to OpenAI
    // We don't await here because the WebSocket connection is handled asynchronously
    // The client WebSocket is returned immediately while the relay setup continues
    handleOpenAIRelay(server, model, user.sub, env);

    // Return the client WebSocket
    // Accept the 'realtime' protocol if requested
    const responseHeaders: HeadersInit = {};
    if (request.headers.get('Sec-WebSocket-Protocol')) {
      responseHeaders['Sec-WebSocket-Protocol'] = 'realtime';
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: responseHeaders
    });
  }
};

/**
 * Handle the relay connection to OpenAI
 */
async function handleOpenAIRelay(
  clientSocket: WebSocket,
  model: string,
  clerkId: string,
  env: Env
) {
  let realtimeClient: RealtimeClient | null = null;
  let messageCount = 0;
  const sessionStart = Date.now();
  let messageQueue: string[] = [];

  try {
    // Log initial connection asynchronously (non-blocking)
    logRealtimeUsage(clerkId, model, env).catch(error => {
      console.error('Failed to log initial connection:', error);
    });

    // Create RealtimeClient instance
    realtimeClient = new RealtimeClient({
      apiKey: env.OPENAI_API_KEY,
      dangerouslyAllowAPIKeyInBrowser: true,
    });

    // Set up OpenAI event listeners before connecting
    realtimeClient.on('server.*', (event: any) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(JSON.stringify(event));
        
        // Track token usage from response.done events (non-blocking)
        if (event.type === 'response.done' && event.response?.usage) {
          handleUsageTracking(event.response.usage, messageCount, clerkId, model, env)
            .catch(error => console.error('Usage tracking error:', error));
        }
      } else {
        // Queue messages if client is not ready
        messageQueue.push(JSON.stringify(event));
      }
    });

    realtimeClient.on('error', (error: any) => {
      console.error('OpenAI Realtime error:', error);
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(JSON.stringify({
          type: 'error',
          error: {
            message: error.message || 'OpenAI connection error',
            type: error.type || 'error'
          }
        }));
        clientSocket.close(1011, 'OpenAI connection error');
      }
    });

    // Connect to OpenAI with timeout protection
    await Promise.race([
      realtimeClient.connect({ model }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI connection timeout')), 10000)
      )
    ]);

    // Send any queued messages
    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      if (message && clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(message);
      }
    }

    // Relay messages from client to OpenAI
    clientSocket.addEventListener('message', (event: MessageEvent) => {
      try {
        messageCount++;
        if (realtimeClient && realtimeClient.isConnected()) {
          // Forward raw event data to RealtimeClient
          // The RealtimeClient expects the complete event object
          const eventData = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
          realtimeClient.realtime.send(eventData);
        }
      } catch (error) {
        console.error('Error forwarding to OpenAI:', error);
      }
    });

    // Handle connection close events
    clientSocket.addEventListener('close', async () => {
      const sessionDuration = (Date.now() - sessionStart) / 1000;
      
      // Log final session stats (non-blocking)
      updateSessionStats(clerkId, model, sessionDuration, messageCount, env)
        .catch(error => console.error('Session stats update error:', error));
      
      // Disconnect RealtimeClient
      if (realtimeClient && realtimeClient.isConnected()) {
        realtimeClient.disconnect();
      }
    });

    // Handle errors
    clientSocket.addEventListener('error', (error) => {
      console.error('Client WebSocket error:', error);
      if (realtimeClient && realtimeClient.isConnected()) {
        realtimeClient.disconnect();
      }
    });

  } catch (error) {
    console.error('Failed to establish OpenAI connection:', error);
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(JSON.stringify({
        type: 'error',
        error: {
          message: 'Failed to establish connection',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      }));
      clientSocket.close(1011, 'Connection failed');
    }
  }
}

/**
 * Handle token usage tracking from OpenAI response with timeout protection
 */
async function handleUsageTracking(
  usage: any,
  messageCount: number,
  clerkId: string,
  model: string,
  env: Env
): Promise<void> {
  return Promise.race([
    (async () => {
      try {
        const totalTokens = (usage.total_tokens || 0) + 
                          (usage.input_tokens || 0) + 
                          (usage.output_tokens || 0);
        
        if (totalTokens > 0) {
          // Get the internal user_id from clerk_id
          const userResult = await env.DB.prepare(`
            SELECT id FROM users WHERE clerk_id = ?
          `).bind(clerkId).first();
          
          if (!userResult) {
            console.error('User not found in database for clerk_id:', clerkId);
            return;
          }

          // Update usage in database using internal user_id
          await env.DB.prepare(`
            UPDATE usage_logs 
            SET tokens = tokens + ?,
                metadata = json_set(
                  COALESCE(metadata, '{}'),
                  '$.input_tokens', ?,
                  '$.output_tokens', ?,
                  '$.message_count', ?
                )
            WHERE user_id = ? AND model = ? AND provider = 'openai'
            ORDER BY created_at DESC
            LIMIT 1
          `).bind(
            totalTokens,
            usage.input_tokens || 0,
            usage.output_tokens || 0,
            messageCount,
            userResult.id,
            model
          ).run();
          
          // Update user's total token usage
          await env.DB.prepare(`
            UPDATE users 
            SET tokens_used = tokens_used + ?, 
                updated_at = datetime('now')
            WHERE clerk_id = ?
          `).bind(totalTokens, clerkId).run();
        }
      } catch (error) {
        console.error('Failed to track usage:', error);
      }
    })(),
    new Promise<void>((_, reject) => 
      setTimeout(() => reject(new Error('Usage tracking timeout')), 5000)
    )
  ]).catch(error => {
    console.error('Usage tracking failed or timed out:', error);
  });
}

/**
 * Update session statistics in database with timeout protection
 */
async function updateSessionStats(
  clerkId: string,
  model: string,
  sessionDuration: number,
  messageCount: number,
  env: Env
): Promise<void> {
  return Promise.race([
    (async () => {
      try {
        // Get the internal user_id from clerk_id
        const userResult = await env.DB.prepare(`
          SELECT id FROM users WHERE clerk_id = ?
        `).bind(clerkId).first();
        
        if (!userResult) {
          console.error('User not found in database for clerk_id:', clerkId);
          return;
        }

        await env.DB.prepare(`
          UPDATE usage_logs 
          SET metadata = json_set(
            COALESCE(metadata, '{}'),
            '$.session_duration', ?,
            '$.message_count', ?
          )
          WHERE user_id = ? AND model = ? AND provider = 'openai'
          ORDER BY created_at DESC
          LIMIT 1
        `).bind(
          sessionDuration,
          messageCount,
          userResult.id,
          model
        ).run();
      } catch (error) {
        console.error('Failed to update session stats:', error);
      }
    })(),
    new Promise<void>((_, reject) => 
      setTimeout(() => reject(new Error('Session stats update timeout')), 5000)
    )
  ]).catch(error => {
    console.error('Session stats update failed or timed out:', error);
  });
}