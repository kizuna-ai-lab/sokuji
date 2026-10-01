// Build-time injected by vite.config.ts (define: { __APP_VERSION__ })
declare const __APP_VERSION__: string | undefined;

/** Format ms timestamp as local "YYYY-MM-DD HH:MM:SS". */
export function formatLocalDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format ms timestamp as local "HH:MM:SS". */
export function formatLocalTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format ms timestamp for use in filename: "YYYYMMDD-HHMMSS" (local time). */
export function formatTimestampForFilename(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Get the `__APP_VERSION__` build constant safely. */
export function getAppVersion(): string | null {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;
  } catch {
    return null;
  }
}

/** The name every export uses: the time, never the content. */
export function exportFilename(extension: 'txt' | 'json', now: number = Date.now()): string {
  return `sokuji-conversation-${formatTimestampForFilename(now)}.${extension}`;
}

/**
 * Copy a text payload to the system clipboard.
 * Returns true on success, false if both the modern and legacy paths fail.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Trigger a file download using a synthetic anchor + blob URL.
 * Works in both Electron renderer and Chrome extension side panel without
 * any extension permissions (uses HTML's standard `download` attribute).
 */
export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
