import { describe, it, expect } from 'vitest';
import { describeElement, MAX_COMPONENTS, type GrabFrame } from './reactGrabFormat';

function button(text: string, cls = 'settings-btn settings-btn--primary'): Element {
  const el = document.createElement('button');
  el.className = cls;
  el.type = 'button';
  el.textContent = text;
  return el;
}

describe('describeElement', () => {
  it('writes the element, then our components nearest first, each at file:line:column', () => {
    const frames: GrabFrame[] = [
      { functionName: 'button' },
      { functionName: 'Button', fileName: 'Button.tsx', lineNumber: 28, columnNumber: 4 },
      { functionName: 'SetupWizard', fileName: 'SetupWizard.tsx', lineNumber: 226, columnNumber: 10 },
    ];
    expect(describeElement(button('下一步'), frames)).toBe([
      '<button class="settings-btn settings-btn--primary" type="button">下一步</button>',
      '  in Button (at Button.tsx:28:4)',
      '  in SetupWizard (at SetupWizard.tsx:226:10)',
    ].join('\n'));
  });

  it('leaves out library frames, and a frame with no line keeps its file', () => {
    const frames: GrabFrame[] = [
      { functionName: 'FloatingPortal', fileName: '@floating-ui_react.js', lineNumber: 10 },
      { functionName: 'Provider', fileName: 'http://localhost:5173/node_modules/.vite/deps/react-i18next.js?v=1', lineNumber: 3 },
      { functionName: 'Tooltip', fileName: 'Tooltip.tsx' },
    ];
    expect(describeElement(button('x'), frames).split('\n').slice(1)).toEqual(['  in Tooltip (at Tooltip.tsx)']);
  });

  it('names a component the extension bundle could not map, without a location', () => {
    const frames: GrabFrame[] = [
      { functionName: 'Button', fileName: 'chrome-extension://abc/assets/AppProviders-RX-N6lpm.js', lineNumber: 46154, columnNumber: 53 },
      { functionName: 'SetupWizard', fileName: 'chrome-extension://abc/fullpage.js', lineNumber: 92677, columnNumber: 66 },
    ];
    expect(describeElement(button('Next'), frames).split('\n').slice(1)).toEqual(['  in Button', '  in SetupWizard']);
  });

  it(`names at most ${MAX_COMPONENTS} components`, () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({ functionName: `C${i}`, fileName: `C${i}.tsx`, lineNumber: i + 1 }));
    expect(describeElement(button('x'), frames).split('\n')).toHaveLength(1 + MAX_COMPONENTS);
  });

  it('shows a drop-down by its selected option', () => {
    const select = document.createElement('select');
    for (const [value, label] of [['en', 'English'], ['zh_CN', '中文 (简体)']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    select.value = 'zh_CN';
    expect(describeElement(select, [])).toBe('<select>中文 (简体)</select>');
  });

  it("never copies a field's value: a password field holds an API key, and React mirrors it into the attribute", () => {
    const key = document.createElement('input');
    key.type = 'password';
    key.setAttribute('aria-label', 'API key');
    key.setAttribute('value', 'sk-secret-123');
    key.value = 'sk-secret-123';
    const copy = describeElement(key, [{ functionName: 'CredentialForm', fileName: 'CredentialForm.tsx', lineNumber: 48 }]);
    expect(copy).not.toContain('sk-secret-123');
    expect(copy).toBe('<input type="password" aria-label="API key">\n  in CredentialForm (at CredentialForm.tsx:48)');
  });

  it('shortens long text and a long opening tag', () => {
    const el = button('a'.repeat(100), 'c'.repeat(300));
    const [first] = describeElement(el, []).split('\n');
    expect(first).toMatch(/^<button class="c+…>a{39}…<\/button>$/);
    expect(first.length).toBeLessThan(220);
  });
});
