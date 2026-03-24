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

export function setupErrorTracking(posthog: PostHog): () => void {
  return () => {};
}
