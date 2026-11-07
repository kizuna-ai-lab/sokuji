// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// WHAT THIS PROTECTS
// The output form factor (headphones / speakers / unknown, issue #691) is joined
// to the browser's output device by exact label (spec 2026-11-05 §5). Chromium
// does not show the system's device name as it is: it appends " (0951:16a4)"
// (USB vendor:product) or " (Bluetooth)" on Windows, builds "<data source or
// name> (<transport>)" on macOS, and rewrites any name holding "AirPods" on every
// platform. The helpers and the parser rebuild those labels by hand. If a new
// Chromium changes any of these rules, nothing breaks loudly: outputs simply read
// "unknown" (the diagnostic log then says "no system device matches …").
//
// WHAT IT WAS CHECKED AGAINST
// Electron 44.5.1 = Chromium 152.0.7977.130, on 2026-11-06, with a real USB
// headset on Windows. This test fails as soon as package.json moves Electron to
// another major, so the rules are checked again before that Electron ships.
const CHECKED = { electronMajor: 44, electron: '44.5.1', chromium: '152.0.7977.130', on: '2026-11-06' };

const WHAT_TO_DO = [
  `Electron's major changed: the output label rules were checked against Electron ${CHECKED.electron} = Chromium ${CHECKED.chromium} (${CHECKED.on}).`,
  'Before raising CHECKED in this file:',
  '1. Find the Chromium version of the new Electron (process.versions.chrome, or the Electron release notes).',
  '2. Compare these Chromium sources with our copies of their rules:',
  '   - media/audio/win/device_enumeration_win.cc: GetDeviceInstanceId, GetDeviceSuffixWin',
  '       -> native/audio-host/win/main.cpp: DeviceInstanceId, ChromiumLabelSuffix',
  '   - media/audio/mac/core_audio_util_mac.cc: CoreAudioUtilMac::GetDeviceLabel',
  '       -> native/audio-host/mac/main.swift: browserLabel',
  '   - media/audio/audio_device_description.cc: RedactDeviceName (run by LocalizeDeviceDescriptions)',
  '       -> electron/output-form-factor-parse.js: chromiumRedactedLabel',
  '3. On real machines, start a session with a USB headset (Windows and macOS) and AirPods or other',
  '   Bluetooth headphones if at hand. With the diagnostic log on, each should log its transport (usb,',
  '   bluetooth) rather than unknown/unknown, and no "no system device matches" line should appear.',
  '4. Save any label that changed as a test case in electron/output-form-factor-parse.test.js, then update',
  '   CHECKED here (and the note in docs/superpowers/specs/2026-11-05-output-form-factor-design.md §5).',
].join('\n');

describe('output labels: the Chromium naming rules we rebuild were checked against the Electron in package.json', () => {
  it(`Electron is still major ${CHECKED.electronMajor} (Chromium ${CHECKED.chromium}); on an upgrade, re-check the label rules (see the failure message)`, () => {
    const repoRoot = path.resolve(__dirname, '..');
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const wanted = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
    expect(typeof wanted, 'package.json names no electron version').toBe('string');
    const major = Number(String(wanted).replace(/^[^0-9]*/, '').split('.')[0]);
    expect(major, WHAT_TO_DO).toBe(CHECKED.electronMajor);
  });
});
