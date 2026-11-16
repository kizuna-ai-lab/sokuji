/**
 * Development builds only: React Grab (https://react-grab.com), for reporting UI bugs (task #83).
 *
 * Press Ctrl+C (⌘C on macOS) with nothing selected to start picking, point at any element, and click it:
 * the clipboard gets the element and the components that rendered it, each at its file:line:column —
 * the line where that component placed the next one in. For example:
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

const api = init({
  telemetry: false,
  // Ctrl+C inside a text field copies its text as usual.
  allowActivationInsideInput: false,
  // React Grab 0.2 writes line numbers only for Next.js apps; ours come from its own stack, formatted here.
  getContent: async (elements) => {
    const parts = await Promise.all(elements.map(async (el) => describeElement(el, (await getStack(el)) ?? [])));
    return parts.join('\n\n');
  },
});

api.registerPlugin({
  name: 'sokuji',
  hooks: {
    // No editor is wired to the dev server; claim the request so nothing leaves the machine.
    onOpenFile: () => true,
  },
});
