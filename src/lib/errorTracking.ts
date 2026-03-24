import type PostHog from 'posthog-js-lite';

export interface StackFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

// Chrome/V8: "    at funcName (url:line:col)" or "    at url:line:col"
const CHROME_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?((?:https?|chrome-extension):\/\/[^\s]+?|[^\s(]+?):(\d+):(\d+)\)?\s*$/;

// Firefox/Safari: "funcName@url:line:col"
const FIREFOX_FRAME_RE = /^(.+?)@((?:https?|moz-extension|safari-extension):\/\/[^\s]+?|[^\s@]+?):(\d+):(\d+)\s*$/;

export function parseStackTrace(stack: string): StackFrame[] {
  if (!stack) return [];

  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    let match = CHROME_FRAME_RE.exec(line);
    if (match) {
      frames.push({
        filename: match[2],
        function: match[1] || '?',
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
        in_app: true,
      });
      continue;
    }

    match = FIREFOX_FRAME_RE.exec(line);
    if (match) {
      frames.push({
        filename: match[2],
        function: match[1] || '?',
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
        in_app: true,
      });
    }
  }

  // Reverse: PostHog expects outermost frame first
  frames.reverse();
  return frames;
}

// Matches common API key patterns: sk-..., AIza..., key-...
const API_KEY_RE = /\b(sk-[a-zA-Z0-9_-]{3,}|AIza[a-zA-Z0-9_-]{3,}|key-[a-zA-Z0-9_-]{3,})\b/g;

export function redactSensitiveData(message: string): string {
  return message.replace(API_KEY_RE, '[REDACTED]');
}

const DEDUP_WINDOW_MS = 5000;
const DEDUP_MAX_ENTRIES = 100;

export interface Deduplicator {
  shouldReport(type: string, message: string, filename?: string, lineno?: number): boolean;
}

export function createDeduplicator(): Deduplicator {
  const seen = new Map<string, number>();

  return {
    shouldReport(type: string, message: string, filename?: string, lineno?: number): boolean {
      const key = `${type}:${message}:${filename ?? ''}:${lineno ?? ''}`;
      const now = Date.now();
      const lastSeen = seen.get(key);

      if (lastSeen !== undefined && now - lastSeen < DEDUP_WINDOW_MS) {
        return false;
      }

      // Evict oldest if at capacity
      if (seen.size >= DEDUP_MAX_ENTRIES && !seen.has(key)) {
        const oldestKey = seen.keys().next().value;
        if (oldestKey !== undefined) {
          seen.delete(oldestKey);
        }
      }

      seen.set(key, now);
      return true;
    },
  };
}

export function setupErrorTracking(posthog: PostHog): () => void {
  return () => {};
}
