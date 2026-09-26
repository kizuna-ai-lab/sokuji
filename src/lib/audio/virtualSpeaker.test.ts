import { describe, it, expect } from 'vitest';
import { findVirtualSpeaker } from './virtualSpeaker';

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
