/**
 * Utility functions for the Sokuji backend
 */

/**
 * Calculate adjusted tokens based on pricing ratios
 */
export function calculateAdjustedTokens(
  inputTokens: number,
  outputTokens: number,
  inputRatio: number,
  outputRatio: number
): {
  adjustedInputTokens: number;
  adjustedOutputTokens: number;
  adjustedTotalTokens: number;
} {
  const adjustedInputTokens = Math.round(inputTokens * inputRatio);
  const adjustedOutputTokens = Math.round(outputTokens * outputRatio);
  const adjustedTotalTokens = adjustedInputTokens + adjustedOutputTokens;

  return {
    adjustedInputTokens,
    adjustedOutputTokens,
    adjustedTotalTokens,
  };
}

/**
 * Get pricing ratios for a given provider and model
 */
export function getPricingRatios(
  provider: string,
  model: string,
  modality: string = "text"
): {
  inputRatio: number;
  outputRatio: number;
} {
  // Default ratios (1:1)
  let inputRatio = 1.0;
  let outputRatio = 1.0;

  // OpenAI pricing ratios
  if (provider === "openai") {
    if (model.includes("gpt-4o-realtime")) {
      if (modality === "audio") {
        // Audio is 6x more expensive for input, 2x for output
        inputRatio = 6.0;
        outputRatio = 2.0;
      } else {
        // Text tokens
        inputRatio = 1.0;
        outputRatio = 1.0;
      }
    } else if (model.includes("gpt-4o")) {
      inputRatio = 1.0;
      outputRatio = 1.0;
    } else if (model.includes("gpt-4")) {
      inputRatio = 2.0;
      outputRatio = 2.0;
    }
  }

  // Google Gemini pricing ratios
  if (provider === "gemini" || provider === "google") {
    if (model.includes("gemini-pro")) {
      inputRatio = 0.5;
      outputRatio = 0.5;
    }
  }

  return { inputRatio, outputRatio };
}

/**
 * Generate a random ID
 */
export function generateId(length: number = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Hash password (use better-auth's built-in password hashing instead)
 * This is just a placeholder - better-auth handles password hashing
 */
export async function hashPassword(password: string): Promise<string> {
  // better-auth handles this internally
  return password;
}

/**
 * Verify password (use better-auth's built-in password verification)
 * This is just a placeholder - better-auth handles password verification
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // better-auth handles this internally
  return password === hash;
}

/**
 * Format timestamp to ISO string
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * Parse JSON safely
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Get user subject identifier
 */
export function getUserSubject(userId: string): { subjectType: "user"; subjectId: string } {
  return {
    subjectType: "user",
    subjectId: userId,
  };
}

/**
 * Get organization subject identifier
 */
export function getOrgSubject(orgId: string): { subjectType: "organization"; subjectId: string } {
  return {
    subjectType: "organization",
    subjectId: orgId,
  };
}
