import { describe, it, expect } from 'vitest';
import { canUseTextInput } from './textInputGate';

const live = {
  isSessionActive: true,
  supportsTextInput: true,
  speakerChannelActive: true,
};

describe('canUseTextInput', () => {
  it('allows text input while the speaker channel is up', () => {
    expect(canUseTextInput(live)).toBe(true);
  });

  // #544: the whole point. Others mode runs the participant leg only, so there
  // is no speaker channel for a typed message to go to. Before this gate the
  // row rendered anyway and every message was silently dropped.
  it('withholds it in participant-only mode', () => {
    expect(canUseTextInput({ ...live, speakerChannelActive: false })).toBe(false);
  });

  // The case that rules out gating on the MODE instead of the live channel: in
  // Both mode the speaker leg can fail to come up while the participant leg
  // survives (split degraded). Mode says "speaker is in scope", but there is no
  // socket to type into.
  it('withholds it when the speaker leg died but the session continues', () => {
    expect(canUseTextInput({
      isSessionActive: true,
      supportsTextInput: true,
      speakerChannelActive: false,
    })).toBe(false);
  });

  it('withholds it before the session starts', () => {
    expect(canUseTextInput({ ...live, isSessionActive: false })).toBe(false);
  });

  it('withholds it on providers that do not accept text', () => {
    expect(canUseTextInput({ ...live, supportsTextInput: false })).toBe(false);
  });
});
