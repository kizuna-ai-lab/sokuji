/**
 * REST API Proxy for CometAPI (OpenAI-compatible)
 * Handles regular HTTP API calls with authentication and billing
 */

import { Env } from '../types';
import { verifyClerkToken } from '../services/clerk';
import { corsHeaders } from '../middleware/cors';


// Extract user from authorization header
async function extractUser(request: Request, env: Env) {
  console.log('[Proxy] Extracting user from authorization header');
  
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    console.log('[Proxy] No valid Bearer token found in Authorization header');
    return null;
  }
  
  const token = authorization.substring(7);
  console.log('[Proxy] Verifying Clerk token, length:', token.length);
  
  const result = await verifyClerkToken(token, env);
  console.log('[Proxy] Token verification result:', { 
    valid: result.valid, 
    userId: result.userId ? `${result.userId.substring(0, 8)}...` : 'none',
    email: result.email || 'none'
  });
  
  if (result.valid && result.userId) {
    console.log('[Proxy] User authenticated successfully:', { userId: result.userId, email: result.email });
    return {
      sub: result.userId,
      email: result.email
    };
  }
  
  console.log('[Proxy] Token verification failed');
  return null;
}


/**
 * Handle REST API proxy for CometAPI endpoints (OpenAI-compatible)
 * Forwards regular HTTP requests to CometAPI with authentication
 */
export async function handleOpenAIProxy(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  const url = new URL(request.url);
  console.log('[Proxy] Incoming request:', {
    method: request.method,
    path: url.pathname,
    search: url.search,
    userAgent: request.headers.get('User-Agent'),
    contentType: request.headers.get('Content-Type')
  });
  
  // Verify authentication
  const user = await extractUser(request, env);
  if (!user) {
    console.log('[Proxy] Authentication failed, returning 401');
    return new Response('Unauthorized', { 
      status: 401,
      headers: corsHeaders 
    });
  }
  
  console.log('[Proxy] User authenticated, proceeding with request');

  // Parse the path to get the API endpoint
  // Remove the /v1 prefix if present to get the clean path
  const path = url.pathname.replace(/^\/v1/, '');
  
  // Forward to CometAPI (OpenAI-compatible)
  const cometAPIUrl = `https://api.cometapi.com/v1${path}${url.search}`;
  console.log('[Proxy] Forwarding to CometAPI URL:', cometAPIUrl);
  
  const cometAPIHeaders = new Headers(request.headers);
  cometAPIHeaders.set('Authorization', `Bearer ${env.COMET_API_KEY}`);
  cometAPIHeaders.delete('Host');
  cometAPIHeaders.delete('CF-Connecting-IP');
  cometAPIHeaders.delete('CF-RAY');
  
  console.log('[Proxy] Request headers prepared, API key:', env.COMET_API_KEY ? 'present' : 'missing');
  
  const cometAPIRequest = new Request(cometAPIUrl, {
    method: request.method,
    headers: cometAPIHeaders,
    body: request.body,
  });

  try {
    console.log('[Proxy] Sending request to CometAPI...');
    const response = await fetch(cometAPIRequest);
    const duration = Date.now() - startTime;
    
    console.log('[Proxy] CometAPI response received:', response.status);
    
    // Log usage for billing
    if (response.ok && request.method === 'POST') {
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
            userId: user.sub,
            model,
            totalTokens,
            provider: 'openai'
          });
          
          await env.DB.prepare(`
            INSERT INTO usage_logs (user_id, model, provider, tokens, metadata, created_at)
            VALUES (?, ?, 'comet', ?, ?, datetime('now'))
          `).bind(
            user.sub,
            model,
            totalTokens,
            JSON.stringify(usage)
          ).run();
          
          console.log('[Proxy] Usage log inserted successfully');
          
          // Update user's token usage
          await env.DB.prepare(`
            UPDATE users 
            SET tokens_used = tokens_used + ?, 
                updated_at = datetime('now')
            WHERE clerk_id = ?
          `).bind(totalTokens, user.sub).run();
          
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
        method: request.method,
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
      method: request.method
    });
    
    return new Response(JSON.stringify({ 
      error: 'Failed to proxy request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}