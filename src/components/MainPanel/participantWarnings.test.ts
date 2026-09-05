import { describe, it, expect } from 'vitest';
import { silentNoPermissionPresentation } from './participantWarnings';

describe('silentNoPermissionPresentation', () => {
  it('earns a modal while no tap has ever delivered audio on this machine', () => {
    expect(silentNoPermissionPresentation({ tapAudioSeen: false })).toBe('modal');
  });

  it('is only a notice once a tap has proven the permission works', () => {
    // Silence from a source that has delivered audio before is a quiet
    // source, not a denial: a meeting between utterances, a paused player.
    expect(silentNoPermissionPresentation({ tapAudioSeen: true })).toBe('notice');
  });
});
