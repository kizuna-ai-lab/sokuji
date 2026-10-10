import { describe, it, expect, vi } from 'vitest';

const os = vi.hoisted(() => ({ name: 'mac' as 'mac' | 'win' | 'linux' }));
vi.mock('../../utils/environment', () => ({
  isLinux: () => os.name === 'linux',
  isWindows: () => os.name === 'win',
}));

import { findVirtualSpeaker, virtualMicrophoneName } from './virtualSpeaker';

const device = (deviceId: string, label: string) => ({ deviceId, label });

describe('findVirtualSpeaker', () => {
  it("prefers Linux's sink, then macOS's driver, then VB-CABLE", () => {
    expect(findVirtualSpeaker([
      device('cable', 'CABLE Input (VB-Audio Virtual Cable)'),
      device('mac', 'SokujiVirtualAudio'),
      device('linux', 'Sokuji_Virtual_Speaker'),
    ])).toBe('linux');
    expect(findVirtualSpeaker([device('cable', 'CABLE Input'), device('mac', 'SokujiVirtualAudio')])).toBe('mac');
    expect(findVirtualSpeaker([device('speakers', 'Speakers'), device('cable', 'Cable Input')])).toBe('cable');
  });

  it('finds none among ordinary devices', () => {
    expect(findVirtualSpeaker([device('speakers', 'Speakers'), device('hdmi', 'HDMI Output')])).toBeUndefined();
  });
});

describe('virtualMicrophoneName', () => {
  it('is the microphone side per OS: Linux remap, Windows VB-Cable, macOS driver', () => {
    os.name = 'linux';
    expect(virtualMicrophoneName()).toBe('Sokuji_Virtual_Mic');
    os.name = 'win';
    expect(virtualMicrophoneName()).toBe('CABLE Output (VB-Audio Virtual Cable)');
    os.name = 'mac';
    expect(virtualMicrophoneName()).toBe('SokujiVirtualAudio');
  });
});
