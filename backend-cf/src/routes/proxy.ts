/**
 * REST API Proxy for OpenAI
 * Handles regular HTTP API calls with authentication and wallet token deduction
 */

import { Hono } from 'hono';
import { Env, HonoVariables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { corsHeaders } from '../middleware/cors';
import { createWalletService } from '../services/wallet';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Handle REST API proxy for OpenAI endpoints
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
  
  // Check wallet balance before making OpenAI request (except for /models endpoint)
  if (path !== '/models' && userId) {
    const walletService = createWalletService(c.env);
    
    // Use optimized getOrCreateWallet to check balance and ensure existence in one query
    const walletBalance = await walletService.getOrCreateWallet('user', userId, 'free_plan');
    
    if (walletBalance) {
      // Check if wallet is frozen
      if (walletBalance.frozen) {
        console.log('[Proxy] Wallet is frozen for user:', userId);
        return c.json({
          error: 'wallet_frozen',
          message: 'Your wallet is frozen. Please contact support.'
        }, 403);
      }
      
      // Check if balance is insufficient (less than 0)
      if (walletBalance.balanceTokens < 0) {
        console.log('[Proxy] Insufficient balance for user:', userId, 'Balance:', walletBalance.balanceTokens);
        return c.json({
          error: 'insufficient_balance',
          message: `Insufficient token balance. Current balance: ${walletBalance.balanceTokens} tokens (negative balance).`,
          balance: walletBalance.balanceTokens
        }, 402);
      }
      
      console.log('[Proxy] Wallet balance check passed. Balance:', walletBalance.balanceTokens);
    } else {
      console.log('[Proxy] Warning: Could not get wallet balance for user, proceeding anyway');
    }
  }
  
  // Forward to OpenAI API
  const openaiUrl = `https://api.openai.com/v1${path}${url.search}`;
  console.log('[Proxy] Forwarding to OpenAI URL:', openaiUrl);
  
  // Get the raw request for headers and body
  const rawRequest = c.req.raw;
  const openaiHeaders = new Headers(rawRequest.headers);
  openaiHeaders.set('Authorization', `Bearer ${c.env.OPENAI_API_KEY}`);
  openaiHeaders.delete('Host');
  openaiHeaders.delete('CF-Connecting-IP');
  openaiHeaders.delete('CF-RAY');
  
  console.log('[Proxy] Request headers prepared, API key:', c.env.OPENAI_API_KEY ? 'present' : 'missing');
  
  const openaiRequest = new Request(openaiUrl, {
    method: c.req.method,
    headers: openaiHeaders,
    body: rawRequest.body,
  });

  try {
    console.log('[Proxy] Sending request to OpenAI...');
    const response = await fetch(openaiRequest);
    
    console.log('[Proxy] OpenAI response received:', response.status);
    
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
          const model = responseBody.model || 'unknown';
          const inputTokens = usage.prompt_tokens || 0;
          const outputTokens = usage.completion_tokens || 0;
          
          console.log('[Proxy] Processing token usage:', {
            userId: userId,
            model,
            provider: 'openai',
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens
          });
          
          // Create wallet service
          const walletService = createWalletService(c.env);
          
          // Ensure wallet exists before attempting to deduct tokens (using optimized method)
          await walletService.getOrCreateWallet('user', userId || 'unknown', 'free_plan');
          
          // Deduct tokens from wallet (pricing calculation happens internally)
          const deductResult = await walletService.useTokens({
            subjectType: 'user',
            subjectId: userId || 'unknown',
            // API usage details
            provider: 'openai',
            model: model,
            endpoint: path,
            method: c.req.method,
            // Raw token counts
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            // Modality
            modality: 'text', // REST API is always text
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
              tokensUsed: inputTokens + outputTokens
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