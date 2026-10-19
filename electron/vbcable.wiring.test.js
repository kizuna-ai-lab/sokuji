// electron/vbcable.wiring.test.js
//
// main.js cannot be booted in vitest; its VB-CABLE wiring is asserted on its
// source text, as sandbox-recovery.wiring.test.js does (spec 2026-10-17 §2-3).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVOKE_CHANNELS } from './ipc-channels.js';
import { createVirtualAudioDevices } from './windows-audio-utils.js';

const read = (file) => readFileSync(join(__dirname, file), 'utf8');
const main = read('main.js');

/** The body of one `ipcMain.handle(channel, ...)`, up to the next handler. */
function handler(channel) {
  const start = main.indexOf(`ipcMain.handle('${channel}'`);
  expect(start, `expected a handler for ${channel}`).toBeGreaterThan(-1);
  const next = main.indexOf('ipcMain.handle(', start + 1);
  return main.slice(start, next === -1 ? undefined : next);
}

describe('VB-CABLE wiring', () => {
  it('answers the distribution channel over IPC, and the renderer may ask', () => {
    expect(handler('get-distribution-channel')).toContain('getDistributionChannel()');
    expect(INVOKE_CHANNELS).toContain('get-distribution-channel');
  });

  it('refuses an install outside the website channel before loading the installer', () => {
    const body = handler('install-vbcable');
    const check = body.indexOf("getDistributionChannel() !== 'website'");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf("require('./vb-cable-installer')"));
    expect(body).toContain('installVBCable()');
  });

  it('never prompts or installs at startup on Windows', async () => {
    expect(read('windows-audio-utils.js')).not.toContain('vb-cable-installer');
    await expect(createVirtualAudioDevices()).resolves.toBe(true);
  });

  it('the installer shows no native dialog', () => {
    const installer = read('vb-cable-installer.js');
    expect(installer).not.toMatch(/\bdialog\b/);
    expect(installer).not.toContain('showMessageBox');
  });
});
