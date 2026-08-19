import { describe, it, expect } from 'vitest';
import { isOwnAppSource, makeSelfIdentity } from './own-app-source.js';

// The participant-source lists are "applications playing audio", and Sokuji
// plays audio: its own translated TTS. These tests pin the identity rules that
// keep Sokuji out of its own list on every platform's row shape.
describe('isOwnAppSource', () => {
  it('matches a row whose pid is one of our processes', () => {
    // macOS reports the app bundle's pid; Chromium's audio service pid arrives
    // via app.getAppMetrics(). Either way membership in the set is ownership.
    const self = makeSelfIdentity({ execPath: '/opt/Sokuji/sokuji', pids: [100, 245] });
    expect(isOwnAppSource({ pid: 245, exe: 'ai.kizuna.sokuji', label: 'Anything' }, self)).toBe(true);
    expect(isOwnAppSource({ pid: 246, exe: 'zoom', label: 'Zoom' }, self)).toBe(false);
  });

  it('matches the Windows exe name against our execPath, ignoring path, case and .exe', () => {
    // The Windows helper reports a bare image name ("Sokuji.exe"); execPath is
    // a full path. Neither the directory nor the suffix carries identity.
    const self = makeSelfIdentity({ execPath: 'C:\\Program Files\\Sokuji\\Sokuji.exe', pids: [100] });
    expect(isOwnAppSource({ pid: 999, exe: 'SOKUJI.EXE', label: 'Sokuji' }, self)).toBe(true);
    expect(isOwnAppSource({ pid: 999, exe: 'Zoom.exe', label: 'Zoom Meetings' }, self)).toBe(false);
  });

  it('matches the PipeWire binary name against a Linux execPath', () => {
    // PipeWire's application.process.binary is a bare name ("sokuji").
    const self = makeSelfIdentity({ execPath: '/usr/lib/sokuji/sokuji', pids: [100] });
    expect(isOwnAppSource({ pid: 4242, exe: 'sokuji', label: 'Sokuji' }, self)).toBe(true);
    expect(isOwnAppSource({ pid: 4242, exe: 'chromium', label: 'Chromium' }, self)).toBe(false);
  });

  it('matches the app name exactly when pid and exe both miss', () => {
    // macOS: the row's exe is a bundle id, which execPath's basename never
    // equals; the localized name is the remaining signal. Exact equality only —
    // an app whose name merely contains "Sokuji" is not us.
    const self = makeSelfIdentity({ execPath: '/x/Electron', pids: [100], appName: 'Sokuji' });
    expect(isOwnAppSource({ pid: null, exe: 'ai.kizuna.sokuji', label: 'sokuji' }, self)).toBe(true);
    expect(isOwnAppSource({ pid: null, exe: 'com.example.notes', label: 'My Sokuji Notes' }, self)).toBe(false);
  });

  it('never matches on absent fields', () => {
    const self = makeSelfIdentity({ execPath: '/opt/Sokuji/sokuji', pids: [100] });
    expect(isOwnAppSource({ pid: null, exe: null, label: null }, self)).toBe(false);
    expect(isOwnAppSource({}, self)).toBe(false);
    // An identity with no appName must not equate two empty labels.
    expect(isOwnAppSource({ pid: 7, exe: '', label: '' }, makeSelfIdentity({ execPath: '', pids: [] }))).toBe(false);
  });

  it('keeps an ordinary conferencing app', () => {
    const self = makeSelfIdentity({
      execPath: 'C:\\Program Files\\Sokuji\\Sokuji.exe',
      pids: [100, 245],
      appName: 'Sokuji',
    });
    expect(isOwnAppSource({ pid: 555, exe: 'Zoom.exe', label: 'Zoom Meetings' }, self)).toBe(false);
  });
});
