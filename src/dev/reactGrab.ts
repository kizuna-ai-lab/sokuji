/**
 * Development builds only: React Grab (https://react-grab.com), for reporting UI bugs (task #83).
 *
 * Press Ctrl+Shift+G (⌘⇧G on macOS) to start picking, point at any element, and click it: the clipboard gets
 * the element and the components that rendered it, each at its file:line:column — the line where that
 * component placed the next one in. The same keys stop picking. For example:
 *
 *   <button class="settings-btn settings-btn--primary settings-btn--md" type="button">下一步</button>
 *     in Button (at Button.tsx:28:4)
 *     in SetupWizard (at SetupWizard.tsx:226:10)
 *
 * Loaded by `reactGrabDev` (vite.react-grab.ts) as each React page's first script, in development builds
 * only, so release builds contain none of it. Nothing about our app leaves the machine:
 * - `telemetry: false` skips React Grab's version check against react-grab.com;
 * - opening a file is answered here (as handled, doing nothing), so React Grab never falls back to
 *   opening react-grab.com/open-file with one of our paths;
 * - the one outside request left is React Grab's own UI font (Geist, from fonts.googleapis.com), which no
 *   option turns off.
 */
import { getStack, init } from 'react-grab/core';
import { describeElement } from './reactGrabFormat';

/**
 * Ctrl+Shift+G ("grab") starts and stops picking. React Grab's default, Ctrl+C, competes with copying text, and
 * its other way out, Escape, is often taken by our own dialogs and pages first. Nothing in the app uses G.
 */
const isGrabKey = (e: KeyboardEvent): boolean =>
  e.code === 'KeyG' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey;

const api = init({
  telemetry: false,
  // Its own key handling is off: a key it also had to stop with did not stop it. The listener below toggles.
  activationKey: () => false,
  // React Grab 0.2 writes line numbers only for Next.js apps; ours come from its own stack, formatted here.
  getContent: async (elements) => {
    const parts = await Promise.all(elements.map(async (el) => describeElement(el, (await getStack(el)) ?? [])));
    return parts.join('\n\n');
  },
});

// Capture phase, before any of the app's own key handlers; picking ends by itself once an element is copied.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.repeat || e.isComposing || !isGrabKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    api.toggle();
  },
  true,
);

api.registerPlugin({
  name: 'sokuji',
  hooks: {
    // No editor is wired to the dev server; claim the request so nothing leaves the machine.
    onOpenFile: () => true,
  },
});
