/**
 * OpenAI-compatible v1 API routes
 * Handles /v1/realtime and /v1/models endpoints with authentication
 */

import { Hono } from 'hono';
import { Env, HonoVariables } from '../types';
import { authMiddleware } from '../middleware/auth';
import proxyRoutes from './proxy';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * WebSocket relay for Realtime API using Durable Objects
 */
app.all('/realtime', authMiddleware, async (c) => {
  console.log('[v1] Routing to realtime relay Durable Object');
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  console.log('[v1] Authenticated user for realtime:', { userId, userEmail });
  
  // Ensure userId is available
  if (!userId) {
    return c.json({ error: 'User ID is required' }, 401);
  }
  
  // Create a unique ID for the Durable Object instance based on userId and timestamp
  // This ensures each connection gets its own instance for proper isolation
  const id = c.env.REALTIME_RELAY.idFromName(`${userId}_${Date.now()}`);
  const durableObject = c.env.REALTIME_RELAY.get(id);
  
  // Create a new request with user context in headers
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-User-Id', userId);
  if (userEmail) {
    headers.set('X-User-Email', userEmail);
  }
  
  const newRequest = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: headers,
    body: c.req.raw.body,
    // @ts-ignore - cf property is Cloudflare-specific
    cf: c.req.raw.cf
  });
  
  // Pass the request to the Durable Object
  return await durableObject.fetch(newRequest);
});

/**
 * REST API proxy for /models endpoint
 * Mount the proxy routes app to handle /models requests
 */
app.route('/models', proxyRoutes);

export default app;