/**
 * Sokuji Backend - Cloudflare Workers
 * Main entry point for the API
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import usageRoutes from './routes/usage';
import healthRoutes from './routes/health';
import v1Routes from './routes/v1';
import { authMiddleware } from './middleware/auth';
import { Env, HonoVariables } from './types';

// Durable Objects removed - using HTTP polling instead

const app = new Hono<{ Bindings: Env }>();

// CORS configuration
app.use('/*', cors({
  origin: (origin) => {
    // Allow requests without origin (curl, Postman, mobile apps, etc.)
    if (!origin) {
      console.log('[CORS] No origin - allowing');
      return 'http://localhost:5173'; // Default to localhost for credentialed requests
    }
    
    const allowed = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:63342',
      'https://sokuji.kizuna.ai',
      'https://www.sokuji.kizuna.ai',
      'https://dev.sokuji.kizuna.ai',
      // Legacy domain removed - now using kizuna.ai
    ];
    
    // Check static origins
    if (allowed.includes(origin)) {
      return origin; // Return the origin string
    }
    
    // Check regex patterns
    const patterns = [
      /^chrome-extension:\/\//,
      /^file:\/\//, // For Electron apps
    ];
    
    for (const pattern of patterns) {
      if (pattern.test(origin)) {
        console.log('[CORS] Regex pattern matched:', origin);
        return origin; // Return the origin string
      }
    }
    
    console.log('[CORS] Origin rejected:', origin);
    return null; // Reject by returning null
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Platform', 'Origin']
}));

// Health check
app.get('/', (c) => {
  return c.json({
    status: 'healthy',
    service: 'Sokuji Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/user', userRoutes);
app.route('/api/usage', usageRoutes);
app.route('/api/health', healthRoutes);
app.route('/v1', v1Routes);

// WebSocket removed - quota sync now handled via HTTP polling in /api/usage routes

// Error handling
app.onError((err, c) => {
  console.error('Error:', err);
  
  if (err.message === 'Unauthorized') {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  if (err.message === 'Not found') {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.json(
    { 
      error: 'Internal server error',
      message: c.env.ENVIRONMENT === 'development' ? err.message : undefined
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

export default app;