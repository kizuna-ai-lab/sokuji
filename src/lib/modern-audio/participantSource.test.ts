import { describe, it, expect } from 'vitest';
import { resolveParticipantSourceId, SYSTEM_PARTICIPANT_SOURCE_ID } from './participantSource';

describe('resolveParticipantSourceId', () => {
  it('returns the selected application source id', () => {
    expect(resolveParticipantSourceId({ deviceId: 'app:pid:42', label: 'Zoom' }))
      .toBe('app:pid:42');
  });

  it('returns the whole-system id when the system source is selected', () => {
    expect(resolveParticipantSourceId({ deviceId: SYSTEM_PARTICIPANT_SOURCE_ID, label: 'System Audio' }))
      .toBe(SYSTEM_PARTICIPANT_SOURCE_ID);
  });

  it('falls back to whole-system capture when nothing is selected', () => {
    expect(resolveParticipantSourceId(null)).toBe(SYSTEM_PARTICIPANT_SOURCE_ID);
    expect(resolveParticipantSourceId(undefined)).toBe(SYSTEM_PARTICIPANT_SOURCE_ID);
  });

  it('falls back when the selection carries no deviceId', () => {
    expect(resolveParticipantSourceId({ deviceId: '', label: 'broken' }))
      .toBe(SYSTEM_PARTICIPANT_SOURCE_ID);
  });
});
