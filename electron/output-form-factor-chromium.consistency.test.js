// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// The output form factor is matched to the browser's device by exact label
// (spec 2026-11-05 §5), so the helpers and the parser rebuild the label
// Chromium shows. Those rules were read from one Chromium's source; a new
// Electron brings a new Chromium, whose names may differ, and every output
// would quietly read unknown. This test fails on an Electron upgrade so the
// rules are checked again before it ships.
const CHECKED = { electronMajor: 44, chromium: '152.0.7977.130' };

const RECHECK = [
  `The output label rules were checked against Chromium ${CHECKED.chromium} (Electron ${CHECKED.electronMajor}).`,
  'Before raising CHECKED, compare the new Chromium with:',
  '  media/audio/win/device_enumeration_win.cc  GetDeviceInstanceId, GetDeviceSuffixWin -> native/audio-host/win/main.cpp ChromiumLabelSuffix',
  '  media/audio/mac/core_audio_util_mac.cc     GetDeviceLabel -> native/audio-host/mac/main.swift browserLabel',
  '  media/audio/audio_device_description.cc    RedactDeviceName -> electron/output-form-factor-parse.js chromiumRedactedLabel',
  'and on a real machine check that a USB headset still logs headphones/usb.',
].join('\n');

describe('the output label rules follow the Chromium they were checked against', () => {
  it('Electron is still the major they were checked with', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const wanted = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
    expect(typeof wanted, 'package.json names no electron version').toBe('string');
    const major = Number(String(wanted).replace(/^[^0-9]*/, '').split('.')[0]);
    expect(major, RECHECK).toBe(CHECKED.electronMajor);
  });
});
