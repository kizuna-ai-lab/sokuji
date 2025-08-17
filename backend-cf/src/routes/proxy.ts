/**
 * REST API Proxy for CometAPI (OpenAI-compatible)
 * Handles regular HTTP API calls with authentication and billing
 */

import { Hono } from 'hono';
import { Env, HonoVariables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { corsHeaders } from '../middleware/cors';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Handle REST API proxy for CometAPI endpoints (OpenAI-compatible)
 * Forwards regular HTTP requests to CometAPI with authentication
 */
app.all('/*', authMiddleware, async (c) => {
  const startTime = Date.now();
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  
  const url = new URL(c.req.url);
  console.log('[Proxy] Incoming request:', {
    method: c.req.method,
    path: url.pathname,
    search: url.search,
    userId: userId ? `${userId.substring(0, 8)}...` : 'none',
    userEmail: userEmail || 'none',
    userAgent: c.req.header('User-Agent'),
    contentType: c.req.header('Content-Type')
  });
  
  console.log('[Proxy] User authenticated, proceeding with request');

  // Parse the path to get the API endpoint
  // Remove the /v1 prefix if present to get the clean path
  const path = url.pathname.replace(/^\/v1/, '');
  
  // Forward to CometAPI (OpenAI-compatible)
  const cometAPIUrl = `https://api.cometapi.com/v1${path}${url.search}`;
  console.log('[Proxy] Forwarding to CometAPI URL:', cometAPIUrl);
  
  // Get the raw request for headers and body
  const rawRequest = c.req.raw;
  const cometAPIHeaders = new Headers(rawRequest.headers);
  cometAPIHeaders.set('Authorization', `Bearer ${c.env.COMET_API_KEY}`);
  cometAPIHeaders.delete('Host');
  cometAPIHeaders.delete('CF-Connecting-IP');
  cometAPIHeaders.delete('CF-RAY');
  
  console.log('[Proxy] Request headers prepared, API key:', c.env.COMET_API_KEY ? 'present' : 'missing');
  
  const cometAPIRequest = new Request(cometAPIUrl, {
    method: c.req.method,
    headers: cometAPIHeaders,
    body: rawRequest.body,
  });

  try {
    console.log('[Proxy] Sending request to CometAPI...');
    const response = await fetch(cometAPIRequest);
    
    console.log('[Proxy] CometAPI response received:', response.status);
    
    // Log usage for billing
    if (response.ok && c.req.method === 'POST') {
      console.log('[Proxy] Processing billing for successful POST request');
      try {
        const clonedResponse = response.clone();
        const responseBody = await clonedResponse.json() as any;
        
        console.log('[Proxy] Response body parsed for billing:', {
          hasUsage: !!responseBody.usage,
          model: responseBody.model || 'unknown',
          usage: responseBody.usage ? {
            totalTokens: responseBody.usage.total_tokens,
            promptTokens: responseBody.usage.prompt_tokens,
            completionTokens: responseBody.usage.completion_tokens
          } : 'none'
        });
        
        // Track token usage
        if (responseBody.usage) {
          const usage = responseBody.usage;
          const totalTokens = usage.total_tokens || 0;
          const model = responseBody.model || 'unknown';
          
          console.log('[Proxy] Recording usage:', {
            userId: userId,
            model,
            totalTokens,
            provider: 'comet'
          });
          
          await c.env.DB.prepare(`
            INSERT INTO usage_logs (user_id, model, provider, tokens, metadata, created_at)
            VALUES (?, ?, 'comet', ?, ?, datetime('now'))
          `).bind(
            userId,
            model,
            totalTokens,
            JSON.stringify(usage)
          ).run();
          
          console.log('[Proxy] Usage log inserted successfully');
          
          // Update user's token usage
          await c.env.DB.prepare(`
            UPDATE users 
            SET tokens_used = tokens_used + ?, 
                updated_at = datetime('now')
            WHERE clerk_id = ?
          `).bind(totalTokens, userId).run();
          
          console.log('[Proxy] User token usage updated successfully');
        } else {
          console.log('[Proxy] No usage data found in response, skipping billing');
        }
      } catch (billingError) {
        console.error('[Proxy] Error processing billing:', billingError);
        // Don't fail the whole request due to billing errors
      }
    } else {
      console.log('[Proxy] Skipping billing:', {
        responseOk: response.ok,
        method: c.req.method,
        reason: !response.ok ? 'response not ok' : 'not POST method'
      });
    }
    
    // Return the response with CORS headers
    console.log('[Proxy] Preparing response with CORS headers');
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });
    
    const finalDuration = Date.now() - startTime;
    console.log('[Proxy] Request completed successfully:', {
      status: response.status,
      totalDuration: `${finalDuration}ms`
    });
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const errorDuration = Date.now() - startTime;
    console.error('[Proxy] Proxy error occurred:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration: `${errorDuration}ms`,
      url: url.pathname,
      method: c.req.method
    });
    
    return c.json({ 
      error: 'Failed to proxy request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;