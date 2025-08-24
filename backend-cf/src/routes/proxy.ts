/**
 * REST API Proxy for CometAPI (OpenAI-compatible)
 * Handles regular HTTP API calls with authentication and wallet token deduction
 */

import { Hono } from 'hono';
import { Env, HonoVariables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { corsHeaders } from '../middleware/cors';
import { createWalletService } from '../services/wallet';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Handle REST API proxy for CometAPI endpoints (OpenAI-compatible)
 * Only allows /models endpoint - all others are rejected
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
  
  // Parse the path to get the API endpoint
  // Remove the /v1 prefix if present to get the clean path
  const path = url.pathname.replace(/^\/v1/, '');
  
  // Only allow /models endpoint
  if (path !== '/models') {
    console.log('[Proxy] Rejected unauthorized endpoint:', path);
    return c.json({ 
      error: 'Forbidden',
      message: 'Only /v1/models and /v1/realtime endpoints are allowed'
    }, 403);
  }
  
  console.log('[Proxy] User authenticated, proceeding with models request');
  
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
    
    // Deduct tokens from wallet for successful POST requests
    if (response.ok && c.req.method === 'POST') {
      console.log('[Proxy] Processing wallet deduction for successful POST request');
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
        
        // Deduct tokens from wallet
        if (responseBody.usage) {
          const usage = responseBody.usage;
          const totalTokens = usage.total_tokens || 0;
          const model = responseBody.model || 'unknown';
          
          console.log('[Proxy] Deducting tokens from wallet:', {
            userId: userId,
            model,
            totalTokens,
            provider: 'comet'
          });
          
          // Create wallet service
          const walletService = createWalletService(c.env);
          
          // Deduct tokens from wallet with detailed usage information
          const deductResult = await walletService.useTokens({
            subjectType: 'user',
            subjectId: userId,
            tokens: totalTokens,
            // API usage details
            provider: 'comet',
            model: model,
            endpoint: path,
            method: c.req.method,
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: usage.completion_tokens || 0,
            metadata: {
              usage_details: usage,
              request_timestamp: new Date().toISOString()
            }
          });
          
          if (!deductResult.success) {
            console.error('[Proxy] Failed to deduct tokens from wallet:', deductResult.error);
            
            // If insufficient balance or frozen, return error response
            if (deductResult.error === 'Insufficient balance') {
              return c.json({
                error: 'insufficient_balance',
                message: `Insufficient token balance. Remaining: ${deductResult.remaining || 0} tokens`,
                remaining: deductResult.remaining || 0
              }, 409);
            } else if (deductResult.error === 'Wallet is frozen') {
              return c.json({
                error: 'wallet_frozen',
                message: 'Your wallet is frozen. Please contact support.'
              }, 403);
            }
            // For other errors, log but don't fail the request
          } else {
            console.log('[Proxy] Tokens deducted successfully:', {
              remaining: deductResult.remaining,
              tokensUsed: totalTokens
            });
          }
        } else {
          console.log('[Proxy] No usage data found in response, skipping wallet deduction');
        }
      } catch (billingError) {
        console.error('[Proxy] Error processing wallet deduction:', billingError);
        // Don't fail the whole request due to billing errors
      }
    } else {
      console.log('[Proxy] Skipping wallet deduction:', {
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