/**
 * CORS headers for proxy responses
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id, X-Platform",
  "Access-Control-Allow-Credentials": "true",
};

/**
 * Create CORS configuration with customizable options
 * Centralizes CORS logic to avoid duplication across routes
 */
export function createCorsConfig(options?: {
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: number;
}) {
  return {
    origin: (origin: string | undefined) => {
      if (!origin) {
        return "http://localhost:5173";
      }

      const allowed = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:63342",
        "https://sokuji.kizuna.ai",
        "https://www.sokuji.kizuna.ai",
        "https://dev.sokuji.kizuna.ai",
      ];

      if (allowed.includes(origin)) {
        return origin;
      }

      const patterns = [/^chrome-extension:\/\//, /^file:\/\//];
      for (const pattern of patterns) {
        if (pattern.test(origin)) {
          return origin;
        }
      }

      return null;
    },
    credentials: true,
    allowMethods: options?.allowMethods || ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: options?.allowHeaders || ["Content-Type", "Authorization", "X-Device-Id", "X-Platform"],
    ...(options?.exposeHeaders && { exposeHeaders: options.exposeHeaders }),
    ...(options?.maxAge && { maxAge: options.maxAge }),
  };
}
