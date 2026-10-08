import { describe, it, expect } from 'vitest';
import type { LegName } from '../../lib/conversation/types';
import { leaseRequest, PARTICIPANT_SPEECH_FIELD, requestBody, requestedRoles, roleFor } from './leaseRequest';

const shape = (legs: LegName[], textOnly = false, participantSpeech = false) => ({ legs, textOnly, participantSpeech });
const settings = (shared: boolean) => ({ region: 'us' as const, bothModeSharedSession: shared });

// The backend's matrix (`managedSonioxSplit.test.ts:34-133`, less "Both + auto", which D20 refuses at the gate).
const TODAY: Array<[string, LegName[], boolean, boolean, string, string[]]> = [
  ['speaker, speaking', ['speaker'], false, true, '{"mode":"speaker","textOnly":false,"bothSplit":false,"region":"us"}', ['spk_stt', 'spk_tts']],
  ['speaker, text only', ['speaker'], true, true, '{"mode":"speaker","textOnly":true,"bothSplit":false,"region":"us"}', ['spk_stt']],
  ['participant only', ['participant'], false, true, '{"mode":"participant","textOnly":true,"bothSplit":false,"region":"us"}', ['par_stt']],
  ['shared Both, speaking', ['speaker', 'participant'], false, true, '{"mode":"both","textOnly":false,"bothSplit":false,"region":"us"}', ['mix_stt', 'mix_tts']],
  ['shared Both, text only', ['speaker', 'participant'], true, true, '{"mode":"both","textOnly":true,"bothSplit":false,"region":"us"}', ['mix_stt']],
  ['split Both, speaking', ['speaker', 'participant'], false, false, '{"mode":"both","textOnly":false,"bothSplit":true,"region":"us"}', ['spk_stt', 'spk_tts', 'par_stt']],
  ['split Both, text only', ['speaker', 'participant'], true, false, '{"mode":"both","textOnly":true,"bothSplit":true,"region":"us"}', ['spk_stt', 'par_stt']],
];

describe('the session-key request, the participant-speech flag off (as shipped)', () => {
  it.each(TODAY)('%s: the body is byte for byte today\'s, whatever the participant wants, and so are the roles', (_name, legs, textOnly, shared, body, roles) => {
    // The shape says the participant would speak: with the flag off, nothing of it reaches the wire.
    const request = leaseRequest(shape(legs, textOnly, true), settings(shared), false);
    expect(JSON.stringify(requestBody(request))).toBe(body);
    expect(requestBody(request)).not.toHaveProperty(PARTICIPANT_SPEECH_FIELD);
    expect(requestedRoles(request)).toEqual(roles);
  });

  it('runs each leg on its own STT role; shared Both\'s participant on none', () => {
    const role = (legs: LegName[], shared: boolean, leg: LegName) => roleFor(leaseRequest(shape(legs), settings(shared), false), leg);
    expect(role(['speaker'], true, 'speaker')).toBe('spk_stt');
    expect(role(['participant'], true, 'participant')).toBe('par_stt');
    expect(role(['speaker', 'participant'], true, 'speaker')).toBe('mix_stt');
    expect(role(['speaker', 'participant'], true, 'participant')).toBeNull();
    expect(role(['speaker', 'participant'], false, 'speaker')).toBe('spk_stt');
    expect(role(['speaker', 'participant'], false, 'participant')).toBe('par_stt');
  });
});

describe('the session-key request, the participant-speech flag on', () => {
  it("serializes the participant's intent under one field, after today's four", () => {
    const speaking = requestBody(leaseRequest(shape(['speaker', 'participant'], false, true), settings(false), true));
    expect(JSON.stringify(speaking)).toBe(`{"mode":"both","textOnly":false,"bothSplit":true,"region":"us","${PARTICIPANT_SPEECH_FIELD}":true}`);
    expect(requestBody(leaseRequest(shape(['speaker', 'participant'], false, false), settings(false), true))[PARTICIPANT_SPEECH_FIELD]).toBe(false);
    // No participant leg: it cannot speak, whatever the switch says.
    expect(requestBody(leaseRequest(shape(['speaker'], false, true), settings(true), true))[PARTICIPANT_SPEECH_FIELD]).toBe(false);
  });

  it('asks for par_tts wherever the participant speaks', () => {
    const roles = (legs: LegName[], textOnly: boolean, shared: boolean) => requestedRoles(leaseRequest(shape(legs, textOnly, true), settings(shared), true));
    expect(roles(['speaker', 'participant'], false, false)).toEqual(['spk_stt', 'spk_tts', 'par_stt', 'par_tts']);
    expect(roles(['speaker', 'participant'], false, true)).toEqual(['mix_stt', 'mix_tts', 'par_tts']);
    expect(roles(['speaker', 'participant'], true, true)).toEqual(['mix_stt', 'par_tts']);
    expect(roles(['participant'], true, true)).toEqual(['par_stt', 'par_tts']);
  });

  it("names the field once — the client's guess until the backend names it", () => {
    expect(PARTICIPANT_SPEECH_FIELD).toBe('participantSpeech');
  });
});

describe('leaseRequest — face-to-face', () => {
  const split = { region: 'us' as const, bothModeSharedSession: false };

  it('is always one shared stream, whatever the setting says', () => {
    const r = leaseRequest({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true, faceToFace: true }, split, true);
    expect(r.bothSplit).toBe(false);
    expect(requestedRoles(r)).toEqual(['mix_stt', 'mix_tts', 'par_tts']);
  });

  it('asks for no voice at all with Text Only on (Review Focus 2)', () => {
    const r = leaseRequest({ legs: ['speaker', 'participant'], textOnly: true, participantSpeech: false, faceToFace: true }, split, true);
    expect(requestedRoles(r)).toEqual(['mix_stt']);
  });
});
