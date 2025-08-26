/**
 * OpenAI-compatible v1 API routes
 * Handles /v1/realtime and /v1/models endpoints with authentication
 */

import { Hono } from 'hono';
import { Env, HonoVariables } from '../types';
import { authMiddleware } from '../middleware/auth';
import realtimeRelay from './realtime-relay';
import proxyRoutes from './proxy';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * WebSocket relay for Realtime API (CometAPI) with authentication
 */
app.all('/realtime', authMiddleware, async (c) => {
  console.log('[v1] Routing to realtime relay endpoint');
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  console.log('[v1] Authenticated user for realtime:', { userId, userEmail });
  
  // Pass user context to the WebSocket relay
  return await realtimeRelay.fetch(c.req.raw, c.env, { userId, userEmail: userEmail || undefined });
});

/**
 * REST API proxy for /models endpoint only
 */
app.all('/models', authMiddleware, async (c) => {
  console.log('[v1] Routing to models proxy endpoint');
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  console.log('[v1] Authenticated user for models:', { userId, userEmail });
  
  // Pass request to proxy handler
  return await proxyRoutes.fetch(c.req.raw, c.env, { userId, userEmail: userEmail || undefined });
});

export default app;