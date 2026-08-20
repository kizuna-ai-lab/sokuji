/**
 * Whether this runtime renders customizable selects (appearance: base-select,
 * Chromium 135+). The packaged Electron (Chromium 144) always does; the
 * extension's floor is Chrome 116, where selects keep the classic OS-drawn
 * popup and rich option markup would be flattened or invisible — callers use
 * this to decide between rich and plain option content.
 *
 * A function, not a module-level constant, so tests can mock it per case.
 */
export function supportsBaseSelect(): boolean {
  try {
    return (
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('appearance', 'base-select')
    );
  } catch {
    return false;
  }
}
