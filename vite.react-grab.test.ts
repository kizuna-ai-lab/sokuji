import { describe, it, expect } from 'vitest'
import { injectReactGrab, reactGrabDev } from './vite.react-grab'

const SRC = '/src/dev/reactGrab.ts'
const TAG = `<script type="module" src="${SRC}"></script>`

describe('reactGrabDev', () => {
  it('applies in development and the extension watch build, never in a release build', () => {
    const apply = reactGrabDev(SRC).apply as (config: object, env: { mode: string; command: string }) => boolean
    expect(apply({}, { mode: 'development', command: 'serve' })).toBe(true)
    expect(apply({}, { mode: 'development', command: 'build' })).toBe(true)
    expect(apply({}, { mode: 'production', command: 'build' })).toBe(false)
  })
})

describe('injectReactGrab', () => {
  it("puts React Grab's script right before the page's React entry, after the classic theme script", () => {
    const html = [
      '<head>',
      '    <script src="./theme-boot.js"></script>',
      '</head>',
      '<body>',
      '    <div id="root"></div>',
      '    <script type="module" src="/shared/index.tsx"></script>',
      '</body>',
    ].join('\n')
    const out = injectReactGrab(html, SRC)
    expect(out.indexOf(TAG)).toBeGreaterThan(out.indexOf('theme-boot.js'))
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf('/shared/index.tsx'))
    expect(out.split(TAG)).toHaveLength(2)
  })

  it('handles an entry one level up (the extension pages)', () => {
    const html = '<body><script type="module" src="../src/subtitle-overlay-entry.tsx"></script></body>'
    const out = injectReactGrab(html, '../src/dev/reactGrab.ts')
    expect(out).toBe('<body><script type="module" src="../src/dev/reactGrab.ts"></script>\n    <script type="module" src="../src/subtitle-overlay-entry.tsx"></script></body>')
  })

  it('leaves a page without a React entry alone (the extension popup)', () => {
    const html = '<body><script type="module" src="./popup.js"></script></body>'
    expect(injectReactGrab(html, SRC)).toBe(html)
  })
})
