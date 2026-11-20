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
export function exportFilename(extension: 'txt' | 'json' | 'srt' | 'vtt', now: number = Date.now()): string {
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
 * The same content in two forms on the clipboard at once (design P1 §3): HTML for an app that reads formatting (a
 * document), plain text for one that does not (a chat box). Where the host has no rich clipboard, or refuses it, the
 * plain text alone is copied. Returns whether anything was copied.
 */
export async function copyRichToClipboard({ html, text }: { html: string; text: string }): Promise<boolean> {
  const Item = (globalThis as { ClipboardItem?: new (data: Record<string, Blob>) => unknown }).ClipboardItem;
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (Item && clipboard?.write) {
    try {
      await clipboard.write([new Item({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }) as ClipboardItem]);
      return true;
    } catch {
      // fall through to the plain text
    }
  }
  return copyToClipboard(text);
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
  // Safari starts the download after the click returns: revoking in the same
  // task leaves it nothing to fetch (the LAN viewer's save runs on iPhones).
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
