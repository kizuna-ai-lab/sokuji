import { describe, it, expect } from 'vitest';
import { resolveAudioHostPath, AUDIO_HOST_REL_PATH } from './audio-host-path.js';

const yes = () => true;
const no = () => false;

describe('resolveAudioHostPath', () => {
  it('prefers the packaged location on win32', () => {
    const p = resolveAudioHostPath({
      platform: 'win32',
      resourcesPath: '/app/resources',
      appPath: '/repo',
      existsSync: yes,
    });
    expect(p).toBe(`/app/resources/${AUDIO_HOST_REL_PATH}`);
  });

  it('falls back to the repo tree when the packaged copy is absent', () => {
    // First candidate (packaged) missing, second (dev tree) present.
    const seen = [];
    const existsSync = (p) => { seen.push(p); return seen.length > 1; };

    const p = resolveAudioHostPath({
      platform: 'win32',
      resourcesPath: '/app/resources',
      appPath: '/repo',
      existsSync,
    });

    expect(p).toBe(`/repo/${AUDIO_HOST_REL_PATH}`);
  });

  it('works when resourcesPath is undefined (plain node, no Electron)', () => {
    const p = resolveAudioHostPath({
      platform: 'win32',
      resourcesPath: undefined,
      appPath: '/repo',
      existsSync: yes,
    });
    expect(p).toBe(`/repo/${AUDIO_HOST_REL_PATH}`);
  });

  it('returns null when the binary is nowhere', () => {
    expect(resolveAudioHostPath({
      platform: 'win32', resourcesPath: '/app/resources', appPath: '/repo', existsSync: no,
    })).toBeNull();
  });

  it('returns null on linux and darwin even if a file happens to exist', () => {
    for (const platform of ['linux', 'darwin']) {
      expect(resolveAudioHostPath({
        platform, resourcesPath: '/app/resources', appPath: '/repo', existsSync: yes,
      })).toBeNull();
    }
  });

  it('returns null rather than throwing when existsSync blows up', () => {
    const existsSync = () => { throw new Error('EACCES'); };
    expect(resolveAudioHostPath({
      platform: 'win32', resourcesPath: '/app/resources', appPath: '/repo', existsSync,
    })).toBeNull();
  });
});
