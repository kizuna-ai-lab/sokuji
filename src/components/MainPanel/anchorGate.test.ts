import { describe, it, expect } from 'vitest';
import { shouldSendAnchor, type AnchorGateInput } from './anchorGate';

const atSessionStart: AnchorGateInput = {
  isActive: true,
  providerSendsAnchors: true,
  channelConnected: true,
  completedTranslations: 0,
  lastAnchorCount: -1,
  interval: 5,
};

describe('shouldSendAnchor', () => {
  it('anchors once at the start of a session', () => {
    expect(shouldSendAnchor(atSessionStart)).toBe(true);
  });

  it('does not anchor once the session has ended', () => {
    expect(shouldSendAnchor({ ...atSessionStart, isActive: false })).toBe(false);
  });

  it('does not anchor on providers that do not use out-of-band responses', () => {
    expect(shouldSendAnchor({ ...atSessionStart, providerSendsAnchors: false })).toBe(false);
  });

  // #546, mechanism 1: the participant leg's connect failure is non-fatal — the
  // session continues on whichever leg came up and the failed client is LEFT in
  // its ref. The old gate only asked whether that ref was non-null, so the
  // start-of-session anchor went straight into a socket that never opened.
  it('does not anchor a channel whose connection never opened', () => {
    expect(shouldSendAnchor({ ...atSessionStart, channelConnected: false })).toBe(false);
  });

  // #546, mechanism 2: speakerClientRef is never cleared on teardown. Start in
  // Both, stop, switch to Others, start again — and the speaker anchor fired on
  // the previous session's disconnected client.
  it('does not anchor a client left behind by an earlier session', () => {
    expect(shouldSendAnchor({
      ...atSessionStart,
      channelConnected: false,
      completedTranslations: 0,
      lastAnchorCount: -1,
    })).toBe(false);
  });

  // #546, mechanism 3: the endpoint drops a socket that did connect. Nothing on
  // our side can prevent that, but the next anchor must not walk into it.
  it('does not anchor after the socket was dropped mid-session', () => {
    expect(shouldSendAnchor({
      isActive: true,
      providerSendsAnchors: true,
      channelConnected: false,
      completedTranslations: 10,
      lastAnchorCount: 5,
      interval: 5,
    })).toBe(false);
  });

  // The connection gate must not CONSUME the pending anchor: the caller only
  // records the count once this returns true, so a channel that comes up late
  // still gets its opening anchor rather than losing it.
  it('still anchors once a late-connecting channel comes up', () => {
    const pending = { ...atSessionStart, channelConnected: false };
    expect(shouldSendAnchor(pending)).toBe(false);
    expect(shouldSendAnchor({ ...pending, channelConnected: true })).toBe(true);
  });

  it('anchors again every interval translations', () => {
    expect(shouldSendAnchor({
      ...atSessionStart, completedTranslations: 5, lastAnchorCount: 0,
    })).toBe(true);
  });

  it('does not anchor the same count twice', () => {
    expect(shouldSendAnchor({
      ...atSessionStart, completedTranslations: 5, lastAnchorCount: 5,
    })).toBe(false);
  });

  it('does not anchor between intervals', () => {
    expect(shouldSendAnchor({
      ...atSessionStart, completedTranslations: 7, lastAnchorCount: 5,
    })).toBe(false);
  });

  // Guards the `completedTranslations > 0` term: 0 % 5 === 0 would otherwise
  // make an empty conversation anchor on every re-render.
  it('does not treat an empty conversation as an interval hit', () => {
    expect(shouldSendAnchor({
      ...atSessionStart, completedTranslations: 0, lastAnchorCount: 0,
    })).toBe(false);
  });
});
