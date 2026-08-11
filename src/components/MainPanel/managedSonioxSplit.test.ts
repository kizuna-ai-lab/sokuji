import { describe, it, expect } from 'vitest';
import {
  resolveManagedSonioxWiring,
  resolveParticipantSlot,
  connectLegAndMarkStarted,
  teardownSessionLegs,
} from './managedSonioxSplit';

/**
 * There is no React rendering harness in this repo, so MainPanel's
 * connectConversation is never mounted or invoked by a test. The house
 * technique (see voicePrepWiring.test.ts / prepareManagedVoice.ts) is to
 * extract the DECISION into a plain function with a real production
 * implementation and test that directly, leaving only side effects inline.
 * These four functions are that extraction for the managed split-Both wiring.
 */

// Every field passes for a managed split Both session with speech output on.
// Each test below breaks exactly ONE field, so precedence is unambiguous.
const splitBoth = {
  speakerWillStart: true,
  participantWillStart: true,
  textOnly: false,
  sonioxSharedBoth: false,
  sonioxSplitBoth: true,
};

describe('resolveManagedSonioxWiring — the seven rows of the mode matrix', () => {
  it('speaker only, speech-to-speech: one leg, spk_stt', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        participantWillStart: false,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'speaker', textOnly: false, bothSplit: false },
      speakerRole: 'spk_stt',
      participantRole: null,
    });
  });

  it('speaker only, text-only: still one leg, still spk_stt', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        participantWillStart: false,
        textOnly: true,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'speaker', textOnly: true, bothSplit: false },
      speakerRole: 'spk_stt',
      participantRole: null,
    });
  });

  it('participant only: par_stt, no speaker leg, bothSplit pinned false', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        speakerWillStart: false,
        sonioxSplitBoth: true, // stale toggle value; mode is not 'both'
      }),
    ).toEqual({
      acquire: { mode: 'participant', textOnly: false, bothSplit: false },
      speakerRole: null,
      participantRole: 'par_stt',
    });
  });

  it('shared Both: ONE mixed stream, so mix_stt and NO participant role', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        sonioxSharedBoth: true,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'both', textOnly: false, bothSplit: false },
      speakerRole: 'mix_stt',
      participantRole: null,
    });
  });

  it('shared Both, text-only: mix_stt, still no participant role', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        textOnly: true,
        sonioxSharedBoth: true,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'both', textOnly: true, bothSplit: false },
      speakerRole: 'mix_stt',
      participantRole: null,
    });
  });

  it('split Both, text-only: two STT legs, spk_stt + par_stt', () => {
    expect(resolveManagedSonioxWiring({ ...splitBoth, textOnly: true })).toEqual({
      acquire: { mode: 'both', textOnly: true, bothSplit: true },
      speakerRole: 'spk_stt',
      participantRole: 'par_stt',
    });
  });

  it('split Both, speech-to-speech: spk_stt + par_stt (the TTS key rides the speaker leg)', () => {
    expect(resolveManagedSonioxWiring(splitBoth)).toEqual({
      acquire: { mode: 'both', textOnly: false, bothSplit: true },
      speakerRole: 'spk_stt',
      participantRole: 'par_stt',
    });
  });

  it('Both selected but no microphone: asks for participant, not both', () => {
    // A key nothing connects still costs: Soniox has no revoke API, so an
    // spk_stt/spk_tts key minted for a leg that never starts is real exposure.
    expect(
      resolveManagedSonioxWiring({ ...splitBoth, speakerWillStart: false }),
    ).toEqual({
      acquire: { mode: 'participant', textOnly: false, bothSplit: false },
      speakerRole: null,
      participantRole: 'par_stt',
    });
  });
});

describe('resolveParticipantSlot — the secondary port is the SHARED path only', () => {
  const sharedCapable = {
    speakerWillStart: true,
    sonioxSharedBoth: true,
    sonioxSplitBoth: false,
    speakerSupportsSecondaryPort: true,
  };

  it('shared Both with a capable speaker core reuses the secondary port', () => {
    expect(resolveParticipantSlot(sharedCapable)).toBe('secondary-port');
  });

  it('split Both NEVER takes the secondary port', () => {
    expect(
      resolveParticipantSlot({
        ...sharedCapable,
        sonioxSharedBoth: false,
        sonioxSplitBoth: true,
      }),
    ).toBe('own-client');
  });

  it('split wins even if shared were somehow also true — the guard is not a fallthrough', () => {
    // Contrast case. sonioxSharedBoth and sonioxSplitBoth are complementary by
    // construction today, so without the explicit split-first clause this test
    // would return 'secondary-port' and the far end would be mixed into the
    // speaker's stream while the par_stt key sat unused.
    expect(
      resolveParticipantSlot({
        ...sharedCapable,
        sonioxSharedBoth: true,
        sonioxSplitBoth: true,
      }),
    ).toBe('own-client');
  });

  it('no speaker leg means there is no core to borrow a port from', () => {
    expect(
      resolveParticipantSlot({ ...sharedCapable, speakerWillStart: false }),
    ).toBe('own-client');
  });

  it('a speaker core without createSecondaryPort falls back to its own client', () => {
    expect(
      resolveParticipantSlot({ ...sharedCapable, speakerSupportsSecondaryPort: false }),
    ).toBe('own-client');
  });
});

describe('connectLegAndMarkStarted — the started bit means "confirmed connected"', () => {
  it('marks the leg started after connect resolves', async () => {
    const order: string[] = [];
    await connectLegAndMarkStarted({
      connect: async () => { order.push('connect'); },
      markStarted: () => { order.push('markStarted'); },
    });
    expect(order).toEqual(['connect', 'markStarted']);
  });

  it('does NOT mark the leg started when connect rejects', async () => {
    // This is the whole reason release is keyed on STARTED rather than on
    // EXPECTED: a bit set for a leg that never opened a socket waits forever
    // for a usage log that cannot arrive, holding the lease — and 409-ing every
    // subsequent Start — until it expires, up to an hour.
    let marked = false;
    await expect(
      connectLegAndMarkStarted({
        connect: async () => { throw new Error('403 loopback denied'); },
        markStarted: () => { marked = true; },
      }),
    ).rejects.toThrow('403 loopback denied');
    expect(marked).toBe(false);
  });

  it('is a no-op wrapper when there is no session to mark (BYOK)', async () => {
    let connected = false;
    await connectLegAndMarkStarted({ connect: async () => { connected = true; } });
    expect(connected).toBe(true);
  });
});

describe('teardownSessionLegs — session-end fires exactly once, after BOTH legs', () => {
  it('runs speaker, then participant, then the session-level end', async () => {
    const order: string[] = [];
    await teardownSessionLegs({
      speaker: async () => { order.push('speaker'); },
      participant: async () => { order.push('participant'); },
      afterBothLegs: () => { order.push('end'); },
    });
    expect(order).toEqual(['speaker', 'participant', 'end']);
  });

  it('still tears the participant down and still ends when the SPEAKER throws', async () => {
    // In split the participant leg is a REAL second Soniox socket. Leaving it
    // open after Stop keeps a stream (and its usage log) alive, and skipping
    // the end signal leaves the lease sitting until expiry.
    const order: string[] = [];
    await expect(
      teardownSessionLegs({
        speaker: async () => { order.push('speaker'); throw new Error('speaker boom'); },
        participant: async () => { order.push('participant'); },
        afterBothLegs: () => { order.push('end'); },
      }),
    ).rejects.toThrow('speaker boom');
    expect(order).toEqual(['speaker', 'participant', 'end']);
  });

  it('still ends when the PARTICIPANT throws', async () => {
    const order: string[] = [];
    await expect(
      teardownSessionLegs({
        speaker: async () => { order.push('speaker'); },
        participant: async () => { order.push('participant'); throw new Error('participant boom'); },
        afterBothLegs: () => { order.push('end'); },
      }),
    ).rejects.toThrow('participant boom');
    expect(order).toEqual(['speaker', 'participant', 'end']);
  });

  it('calls the end hook exactly once per teardown', async () => {
    let ends = 0;
    await teardownSessionLegs({
      speaker: async () => {},
      participant: async () => {},
      afterBothLegs: () => { ends += 1; },
    });
    expect(ends).toBe(1);
  });

  it('does not wait on a participant leg that never came up', async () => {
    const order: string[] = [];
    await teardownSessionLegs({
      speaker: async () => { order.push('speaker'); },
      afterBothLegs: () => { order.push('end'); },
    });
    expect(order).toEqual(['speaker', 'end']);
  });
});

describe('resolveManagedSonioxWiring — the roles agree with the body that was sent', () => {
  /**
   * The server expands `{ mode, textOnly, bothSplit }` into the role set
   * (sokuji-backend `expandStreamRoles`), and `credentialsFor` throws for a role
   * that was never issued while `session-started` answers 400 `role_not_issued`.
   * So the roles this function reports must be a function of the body it just
   * built, not of the two booleans that produced it — the two disagree in every
   * combination below, each of which is reachable in code even where the Start
   * gate makes it unreachable through the UI.
   */

  it('shared Both with NO microphone asks for participant AND names par_stt', () => {
    // Reachable today for every managed account: sonioxUsesSharedBothSession
    // forces shared, and `speakerWillStart` is false whenever no input device
    // is selected. Deriving the role from `sonioxSharedBoth` reports "no
    // participant role" while the body just asked for a par_stt key — the
    // participant leg would then be built with no credentials at all and the
    // managed descriptor would refuse to construct it.
    expect(
      resolveManagedSonioxWiring({
        speakerWillStart: false,
        participantWillStart: true,
        textOnly: true,
        sonioxSharedBoth: true,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'participant', textOnly: true, bothSplit: false },
      speakerRole: null,
      participantRole: 'par_stt',
    });
  });

  it('neither shared nor split (Both + an auto source) still names the mixed role', () => {
    // sonioxBothModePlan answers { shared: false, split: false } when the user
    // prefers shared but left the source language on 'auto'. The body then says
    // bothSplit: false, which the server expands to mix_stt — so calling the
    // speaker leg spk_stt would ask for a key that was never minted and fail
    // the whole Start. The Start gate closes on this combination first
    // (sonioxAutoParticipantBlocked); the wiring must not depend on that.
    expect(
      resolveManagedSonioxWiring({
        speakerWillStart: true,
        participantWillStart: true,
        textOnly: false,
        sonioxSharedBoth: false,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'both', textOnly: false, bothSplit: false },
      speakerRole: 'mix_stt',
      participantRole: null,
    });
  });

  it('shared AND split both true resolves the same way resolveParticipantSlot does', () => {
    // The contrast case resolveParticipantSlot already pins: split wins there,
    // so the slot is a client of its own and it needs a par_stt bundle. Reading
    // `sonioxSharedBoth` here would answer "no participant role" for the very
    // slot the other function just said opens its own socket.
    const input = {
      speakerWillStart: true,
      participantWillStart: true,
      textOnly: false,
      sonioxSharedBoth: true,
      sonioxSplitBoth: true,
    };
    expect(resolveParticipantSlot({ ...input, speakerSupportsSecondaryPort: true }))
      .toBe('own-client');
    expect(resolveManagedSonioxWiring(input)).toEqual({
      acquire: { mode: 'both', textOnly: false, bothSplit: true },
      speakerRole: 'spk_stt',
      participantRole: 'par_stt',
    });
  });
});

describe('resolveManagedSonioxWiring — every reachable input agrees with the server', () => {
  /**
   * The client and the server must name the same STT roles for the same body,
   * and neither can discover a disagreement at runtime in a way the user would
   * survive: `credentialsFor` throws for a role that was never issued, and
   * `session-started` answers 400 `role_not_issued` and then never extends the
   * lease past its start window.
   *
   * `expectedSttRoles` below is a transcription of the STT half of the
   * backend's `expandStreamRoles` (sokuji-backend `src/config/soniox.ts`), which
   * is the only authority on what a body expands to. Kept as a table rather
   * than as spot checks because "total and closed" is the property under test —
   * a sample cannot tell an eighth reachable role set from a seventh.
   */
  function expectedSttRoles(acquire: { mode: string; bothSplit: boolean }): string[] {
    if (acquire.mode === 'speaker') return ['spk_stt'];
    if (acquire.mode === 'participant') return ['par_stt'];
    return acquire.bothSplit ? ['spk_stt', 'par_stt'] : ['mix_stt'];
  }

  const BOOLS = [true, false];
  const ALL_INPUTS = BOOLS.flatMap((speakerWillStart) =>
    BOOLS.flatMap((participantWillStart) =>
      BOOLS.flatMap((textOnly) =>
        BOOLS.flatMap((sonioxSharedBoth) =>
          BOOLS.map((sonioxSplitBoth) => ({
            speakerWillStart, participantWillStart, textOnly, sonioxSharedBoth, sonioxSplitBoth,
          })),
        ),
      ),
    ),
  // Neither channel starting never reaches acquire: connectConversation bails
  // on that combination before any session exists.
  ).filter((i) => i.speakerWillStart || i.participantWillStart);

  it('names exactly the STT roles the server issues, for all 24 reachable inputs', () => {
    expect(ALL_INPUTS).toHaveLength(24);
    for (const input of ALL_INPUTS) {
      const wiring = resolveManagedSonioxWiring(input);
      const named = [wiring.speakerRole, wiring.participantRole].filter(Boolean);
      expect(
        named.sort(),
        `roles disagree with the server for ${JSON.stringify(input)}`,
      ).toEqual(expectedSttRoles(wiring.acquire).sort());
    }
  });

  it('never asks for a leg that will not start, and never leaves one unnamed', () => {
    for (const input of ALL_INPUTS) {
      const wiring = resolveManagedSonioxWiring(input);
      // A key nothing connects is real exposure: Soniox has no revoke API.
      if (!input.speakerWillStart) expect(wiring.speakerRole).toBeNull();
      if (!input.participantWillStart) expect(wiring.participantRole).toBeNull();
      // Every leg that starts is covered by a role, either its own or — for the
      // participant of a shared Both session — the mixed stream it feeds.
      if (input.speakerWillStart) expect(wiring.speakerRole).not.toBeNull();
      if (input.participantWillStart) {
        expect(wiring.participantRole !== null || wiring.speakerRole === 'mix_stt').toBe(true);
      }
    }
  });
});
