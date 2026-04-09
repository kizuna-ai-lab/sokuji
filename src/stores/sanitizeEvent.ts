/** Format byte count as human-readable string: "512B", "45.0KB", "2.5MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

// Estimate decoded size of a base64 string
function base64ByteSize(str: string): number {
  return Math.ceil(str.length * 3 / 4);
}

// Check if a long string is likely base64-encoded
function isLikelyBase64(str: string): boolean {
  if (str.length <= 200) return false;
  // Count base64-valid characters
  let validChars = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (
      (c >= 65 && c <= 90) ||  // A-Z
      (c >= 97 && c <= 122) || // a-z
      (c >= 48 && c <= 57) ||  // 0-9
      c === 43 || c === 47 || c === 61 // + / =
    ) {
      validChars++;
    }
  }
  return validChars / str.length > 0.9;
}

const AUDIO_FIELD_NAMES = new Set([
  'audio', 'audioData', 'audio_data', 'pcmData', 'buffer', 'wav', 'pcm'
]);

/** Sanitize event data by removing large binary/base64 audio payloads. */
export function sanitizeEvent(event: any): any {
  // Primitives and nulls pass through
  if (!event || typeof event !== 'object') {
    // Layer 2: generic base64 detection on strings
    if (typeof event === 'string' && isLikelyBase64(event)) {
      return `<base64:${formatBytes(base64ByteSize(event))}>`;
    }
    return event;
  }

  // ArrayBuffer / TypedArray → placeholder
  if (event instanceof ArrayBuffer) {
    return `<binary:${formatBytes(event.byteLength)}>`;
  }
  if (ArrayBuffer.isView(event)) {
    return `<binary:${formatBytes(event.byteLength)}>`;
  }

  // Arrays → recurse each element
  if (Array.isArray(event)) {
    return event.map(item => sanitizeEvent(item));
  }

  // --- Layer 1: Structure-aware detection ---
  // If this object has mimeType starting with "audio/" and a "data" key,
  // replace "data" with an audio placeholder, copy everything else normally.
  const mimeType = event.mimeType;
  const isAudioMimeObject =
    typeof mimeType === 'string' &&
    mimeType.startsWith('audio/') &&
    'data' in event;

  const sanitized: any = {};
  for (const key in event) {
    if (!event.hasOwnProperty(key)) continue;
    const value = event[key];

    // Layer 1: replace data in audio-mimeType objects
    if (isAudioMimeObject && key === 'data') {
      if (typeof value === 'string') {
        sanitized[key] = `<audio:${formatBytes(base64ByteSize(value))}>`;
      } else if (value instanceof ArrayBuffer) {
        sanitized[key] = `<audio:${formatBytes(value.byteLength)}>`;
      } else if (ArrayBuffer.isView(value)) {
        sanitized[key] = `<audio:${formatBytes(value.byteLength)}>`;
      } else {
        sanitized[key] = `<audio:unknown>`;
      }
      continue;
    }

    // Layer 3: field-name rules for known audio fields
    if (AUDIO_FIELD_NAMES.has(key)) {
      if (value instanceof ArrayBuffer) {
        sanitized[key] = `<binary:${formatBytes(value.byteLength)}>`;
        continue;
      }
      if (ArrayBuffer.isView(value)) {
        sanitized[key] = `<binary:${formatBytes(value.byteLength)}>`;
        continue;
      }
      if (Array.isArray(value) && value.length > 1000) {
        sanitized[key] = `<binary:${formatBytes(value.length * 4)}>`;
        continue;
      }
      if (typeof value === 'string' && value.length > 200) {
        sanitized[key] = `<audio:${formatBytes(base64ByteSize(value))}>`;
        continue;
      }
      // Small values in audio fields: recurse normally
    }

    // Layer 2: generic base64 detection on string values
    if (typeof value === 'string' && isLikelyBase64(value)) {
      sanitized[key] = `<base64:${formatBytes(base64ByteSize(value))}>`;
      continue;
    }

    // Default: recurse
    sanitized[key] = sanitizeEvent(value);
  }

  return sanitized;
}
