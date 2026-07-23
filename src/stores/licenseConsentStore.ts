/**
 * Per-device consent for downloading native model cards whose catalog descriptor
 * carries a non-commercial license (NativeModelCardSpec.license.nonCommercial —
 * see src/lib/local-inference/native/nativeCatalog.ts). Acknowledged once per
 * model id, persisted to localStorage so it survives a reload.
 *
 * This is a per-device UI acknowledgment, not a legal record — a fresh browser
 * profile/device (or cleared storage) re-prompts, which is the intended
 * behavior. Deliberately a plain module rather than a zustand store: nothing
 * in the UI needs to re-render reactively when consent changes (the check
 * happens once, inside the Download click handler), so a tiny read/write pair
 * over localStorage keeps this self-contained.
 */

const STORAGE_KEY = 'sokuji:acceptedLicenses';

function readAccepted(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    // localStorage unavailable or corrupted value — treat as "nothing accepted yet".
    return new Set();
  }
}

function writeAccepted(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable (private browsing quota, etc.) — consent simply
    // won't survive reload; the modal will re-prompt next time, which is safe.
  }
}

/** Whether the user has already acknowledged the non-commercial license for this model id. */
export function hasAcceptedLicense(id: string): boolean {
  return readAccepted().has(id);
}

/** Record that the user acknowledged the non-commercial license for this model id. */
export function acceptLicense(id: string): void {
  const accepted = readAccepted();
  if (accepted.has(id)) return;
  accepted.add(id);
  writeAccepted(accepted);
}
