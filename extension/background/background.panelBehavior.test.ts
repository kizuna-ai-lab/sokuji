// The background worker cannot be booted in vitest: its wiring is asserted on
// its source text, as `background.wsHeaders.test.ts` does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const background = readFileSync(join(__dirname, 'background.js'), 'utf8');
const code = background.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

describe('the background worker: the panel behavior an old build left on', () => {
  it('turns it off on every install and update, so the icon click reaches onClicked', () => {
    const listener = code.slice(code.indexOf('chrome.runtime.onInstalled.addListener(() => {\n  chrome.sidePanel.setPanelBehavior'));
    expect(listener.startsWith('chrome.runtime.onInstalled.addListener')).toBe(true);
    expect(listener.slice(0, listener.indexOf('\n});'))).toContain('chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })');
  });

  it('never turns it on', () => {
    expect(code).not.toContain('openPanelOnActionClick: true');
  });
});
