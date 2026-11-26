import { describe, expect, it, vi } from 'vitest';
import { appTrack, setAppTrack } from './appTrack';

describe('appTrack', () => {
  // Code outside React (the notes runner, the file jobs) reports through this; the page hands it the analytics
  // client's `track` once it has one, and whatever it hands last is what is used.
  it('drops events until the page has handed it a track, then forwards to the latest', () => {
    expect(() => appTrack('notes_started', { service: 'x' })).not.toThrow();
    const first = vi.fn();
    const second = vi.fn();
    setAppTrack(first);
    appTrack('notes_started', { service: 'a' });
    setAppTrack(second);
    appTrack('notes_started', { service: 'b' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('notes_started', { service: 'b' });
  });
});
