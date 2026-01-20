/**
 * Environment configuration loader for AI Model Testing Framework
 */

import { resolve, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import type { RunnerConfig } from './types.js';

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base directory for ai-tests
const AI_TESTS_DIR = resolve(__dirname, '..');

/**
 * Load environment variables from .env file if it exists
 */
function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          // Don't override existing env vars
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  }
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(options: { verbose?: boolean } = {}): RunnerConfig {
  // Load .env file
  loadDotEnv();

  const config: RunnerConfig = {
    testCasesDir: resolve(AI_TESTS_DIR, 'test-cases'),
    resultsDir: resolve(AI_TESTS_DIR, 'results'),
    audioDir: resolve(AI_TESTS_DIR, 'audio'),
    schemasDir: resolve(AI_TESTS_DIR, 'schemas'),
    apiKeys: {
      openai: process.env.OPENAI_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      palabraai: process.env.PALABRA_API_KEY,
      kizunaai: process.env.KIZUNA_API_KEY,
    },
    judge: {
      provider: process.env.JUDGE_PROVIDER || 'openai',
      model: process.env.JUDGE_MODEL || 'gpt-4o',
    },
    verbose: options.verbose || process.env.VERBOSE === 'true',
  };

  return config;
}

/**
 * Validate configuration
 */
export function validateConfig(config: RunnerConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check directories exist
  if (!existsSync(config.testCasesDir)) {
    errors.push(`Test cases directory not found: ${config.testCasesDir}`);
  }
  if (!existsSync(config.schemasDir)) {
    errors.push(`Schemas directory not found: ${config.schemasDir}`);
  }

  // Check at least one API key is provided
  const hasApiKey = Object.values(config.apiKeys).some(key => key && key.trim() !== '');
  if (!hasApiKey) {
    errors.push('No API keys configured. Set at least one of: OPENAI_API_KEY, GEMINI_API_KEY, PALABRA_API_KEY, KIZUNA_API_KEY');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get API key for a specific provider
 */
export function getApiKeyForProvider(config: RunnerConfig, provider: string): string | undefined {
  const providerMap: Record<string, keyof RunnerConfig['apiKeys']> = {
    openai: 'openai',
    gemini: 'gemini',
    palabra_ai: 'palabraai',
    palabraai: 'palabraai',
    kizuna_ai: 'kizunaai',
    kizunaai: 'kizunaai',
    openai_compatible: 'openai', // Use OpenAI key for compatible APIs
  };

  const keyName = providerMap[provider.toLowerCase()];
  return keyName ? config.apiKeys[keyName] : undefined;
}

/**
 * Get the base directory for AI tests
 */
export function getAITestsDir(): string {
  return AI_TESTS_DIR;
}

/**
 * Read package.json to get app version
 */
export function getAppVersion(): string {
  try {
    const packagePath = resolve(process.cwd(), 'package.json');
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
      return packageJson.version || 'unknown';
    }
  } catch {
    // Ignore errors
  }
  return 'unknown';
}

export { AI_TESTS_DIR };
