import { describe, it, expect } from 'vitest';
import { canAuditionVoice } from './voicePreviewable';

describe('canAuditionVoice', () => {
  it('lets a clone audition by default — a clip or a cloned voice stands behind it', () => {
    expect(canAuditionVoice({ group: 'custom' })).toBe(true);
  });

  it('refuses a preset by default — most providers publish no way to synthesize one', () => {
    expect(canAuditionVoice({ group: 'builtin' })).toBe(false);
  });

  it('honours an explicit flag in both directions', () => {
    expect(canAuditionVoice({ group: 'builtin', previewable: true })).toBe(true);
    expect(canAuditionVoice({ group: 'custom', previewable: false })).toBe(false);
  });

  it('refuses a disabled entry whatever it declares — nothing playable stands behind it', () => {
    expect(canAuditionVoice({ group: 'custom', disabled: true })).toBe(false);
    expect(canAuditionVoice({ group: 'builtin', previewable: true, disabled: true })).toBe(false);
  });
});
