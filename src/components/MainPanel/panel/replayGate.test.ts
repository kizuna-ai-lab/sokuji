import { describe, it, expect } from 'vitest';
import { replayBlocked } from './replayGate';
import type { RunState } from '../../../lib/session/types';

const running: RunState = { phase: 'running', since: 0, legs: { participant: 'live' } };
const speakerOnly: RunState = { phase: 'running', since: 0, legs: { speaker: 'live' } };
const idle: RunState = { phase: 'idle' };

describe('replayBlocked', () => {
  it('blocks whole-system participant capture on Electron', () => {
    expect(replayBlocked({
      run: running,
      platform: 'electron',
      participantSourceId: 'desktop-audio-loopback',
      participantNoticeCodes: [],
    })).toBe(true);
  });

  it('blocks when the participant source is not known yet', () => {
    expect(replayBlocked({
      run: running,
      platform: 'electron',
      participantSourceId: undefined,
      participantNoticeCodes: [],
    })).toBe(true);
  });

  it('allows an application source with no fallback notice this run', () => {
    expect(replayBlocked({
      run: running,
      platform: 'electron',
      participantSourceId: 'app:42',
      participantNoticeCodes: [],
    })).toBe(false);
  });

  it('blocks an application source that fell back to the whole system (capture lost)', () => {
    expect(replayBlocked({
      run: running,
      platform: 'electron',
      participantSourceId: 'app:42',
      participantNoticeCodes: ['app_capture_lost_using_system_audio'],
    })).toBe(true);
  });

  it('blocks an application source that fell back to the whole system (monitor missing)', () => {
    expect(replayBlocked({
      run: running,
      platform: 'electron',
      participantSourceId: 'app:42',
      participantNoticeCodes: ['app_capture_monitor_missing'],
    })).toBe(true);
  });

  it('allows replay while idle', () => {
    expect(replayBlocked({
      run: idle,
      platform: 'electron',
      participantSourceId: undefined,
      participantNoticeCodes: [],
    })).toBe(false);
  });

  it('allows replay when only the speaker leg is running', () => {
    expect(replayBlocked({
      run: speakerOnly,
      platform: 'electron',
      participantSourceId: undefined,
      participantNoticeCodes: [],
    })).toBe(false);
  });

  it.each(['extension', 'web'] as const)('allows replay on %s, which never captures the whole system this way', (platform) => {
    expect(replayBlocked({
      run: running,
      platform,
      participantSourceId: undefined,
      participantNoticeCodes: [],
    })).toBe(false);
  });
});
