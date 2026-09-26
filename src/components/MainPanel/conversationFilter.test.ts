import { describe, it, expect } from 'vitest';
import type { DisplayMode } from '../../stores/settingsStore';
import { modeToToggles, togglesToMode } from './conversationFilter';

describe('modeToToggles / togglesToMode', () => {
  it('maps both to src+trans checked', () => {
    expect(modeToToggles('both')).toEqual({ src: true, trans: true });
  });

  it('maps source to src checked only', () => {
    expect(modeToToggles('source')).toEqual({ src: true, trans: false });
  });

  it('maps translation to trans checked only', () => {
    expect(modeToToggles('translation')).toEqual({ src: false, trans: true });
  });

  it('maps none to neither checked', () => {
    expect(modeToToggles('none')).toEqual({ src: false, trans: false });
  });

  it('round-trips every mode through the toggles and back', () => {
    const modes: DisplayMode[] = ['both', 'source', 'translation', 'none'];
    for (const mode of modes) {
      expect(togglesToMode(modeToToggles(mode))).toBe(mode);
    }
  });

  it('round-trips every toggle pair through the mode and back', () => {
    for (const src of [true, false]) {
      for (const trans of [true, false]) {
        expect(modeToToggles(togglesToMode({ src, trans }))).toEqual({ src, trans });
      }
    }
  });
});
