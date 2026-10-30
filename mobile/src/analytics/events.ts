// The desktop's event names and properties (src/lib/analytics.ts:
// translation_session_start / translation_session_end), so one PostHog insight
// covers both apps. The fields are restated here rather than imported: even a
// type import of that module makes tsc check it, and it reaches Vite-only code.
const PROVIDER = 'kizunaai_soniox';

export interface SessionStartProperties {
  session_id: string;
  source_language: string;
  target_language: string;
  provider: string;
  transport: string;
  platform: 'ios' | 'android';
  participant_speech: boolean;
}

export interface SessionEndProperties {
  session_id: string;
  /** Milliseconds, as the desktop's runner reports it. */
  duration: number;
  provider: string;
  error_count: number;
}

export type AnalyticsEvents = {
  translation_session_start: SessionStartProperties;
  translation_session_end: SessionEndProperties;
};

export function sessionStartProperties(o: {
  sessionId: string;
  source: string;
  target: string;
  platform: 'ios' | 'android';
  /** R13: the translation is read aloud: the shape the backend granted at the first listening. */
  participantSpeech?: boolean;
}): SessionStartProperties {
  return {
    session_id: o.sessionId,
    source_language: o.source,
    target_language: o.target,
    provider: PROVIDER,
    transport: 'websocket',
    platform: o.platform,
    participant_speech: o.participantSpeech ?? false,
  };
}

export function sessionEndProperties(o: {
  sessionId: string;
  durationMs: number;
  errorCount: number;
}): SessionEndProperties {
  return {
    session_id: o.sessionId,
    duration: o.durationMs,
    provider: PROVIDER,
    error_count: o.errorCount,
  };
}
