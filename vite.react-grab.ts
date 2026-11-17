import type { Plugin } from 'vite'

/**
 * Development builds only: loads React Grab (src/dev/reactGrab.ts) on every page that runs our React app,
 * as the page's FIRST module script (task #83).
 *
 * React Grab reads React's internals through the devtools hook, which must exist before react-dom runs
 * (bippy: "must be imported BEFORE react"). An `import()` from a page's entry runs only after that entry's
 * own imports, react-dom included, so it is too late. A module script placed before the entry runs first:
 * module scripts execute in document order.
 *
 * Applied in every mode except `production`: the dev server (`npm run dev`, `npm run electron:dev`) and the
 * extension's watch build (`vite build --mode development`). Release builds never see this plugin, so they
 * contain neither the script nor React Grab.
 *
 * @param src The script's `src` as the pages of this config write it (the extension's pages sit one level
 *   below the repository root).
 */
export function reactGrabDev(src: string): Plugin {
  return {
    name: 'sokuji-react-grab-dev',
    apply: (_config, env) => env.mode !== 'production' && env.mode !== 'e2e',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => injectReactGrab(html, src),
    },
  }
}

const MODULE_ENTRY = /<script\b[^>]*\btype="module"[^>]*\bsrc="[^"]*\.tsx"[^>]*><\/script>/

/** The page with React Grab's script before its React entry; a page without a `.tsx` module entry (the extension popup) unchanged. */
export function injectReactGrab(html: string, src: string): string {
  const entry = MODULE_ENTRY.exec(html)
  if (!entry) return html
  const tag = `<script type="module" src="${src}"></script>`
  return html.slice(0, entry.index) + tag + '\n    ' + html.slice(entry.index)
}
