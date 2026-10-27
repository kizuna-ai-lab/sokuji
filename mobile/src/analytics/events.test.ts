import { describe, it, expect } from 'vitest';
import { sessionStartProperties, sessionEndProperties } from './events';

// The desktop's two session events, with the phone's platform: the same names,
// so one PostHog insight covers both apps.
describe('sessionStartProperties', () => {
  it('names the session, the pair, the managed provider and the platform', () => {
    expect(sessionStartProperties({ sessionId: 's-1', source: 'auto', target: 'zh', platform: 'ios' })).toEqual({
      session_id: 's-1',
      source_language: 'auto',
      target_language: 'zh',
      provider: 'kizunaai_soniox',
      transport: 'websocket',
      platform: 'ios',
      participant_speech: false,
    });
  });
});

describe('sessionEndProperties', () => {
  it('reports the duration in milliseconds, as the desktop does, and the error count', () => {
    expect(sessionEndProperties({ sessionId: 's-1', durationMs: 90500, errorCount: 2 })).toEqual({
      session_id: 's-1',
      duration: 90500,
      provider: 'kizunaai_soniox',
      error_count: 2,
    });
  });
});
