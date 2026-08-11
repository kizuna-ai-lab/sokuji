import type {
  SonioxSessionMatrixInput,
} from '../../services/clients/ManagedSonioxSession';

/**
 * Pure wiring decisions for a managed (Kizuna AI) Soniox session, extracted out
 * of MainPanel's connectConversation / disconnectConversation.
 *
 * There is no React rendering harness in this repo, so anything that can be a
 * plain function is one — the same discipline `resolveVoicePrepOutcome`
 * (prepareManagedVoice.ts) follows, and for the same reason: the alternative is
 * a hand-transcribed duplicate inside a test that drifts from the real branch
 * without either side noticing. Only the side effects stay inline in MainPanel.
 */

export interface ManagedSonioxWiring {
  /**
   * Body of `POST /soniox/session-key`. The client sends the three MATRIX
   * INPUTS and the server expands them into the role set — it never sends a
   * stream list. A client-declared list plus a validating blocklist is
   * strictly weaker: a request for `['spk_tts']` alone passes "no par_tts" and
   * "at most one *_tts", yet mints a non-single_use TTS key valid for the whole
   * granted duration against an API with no revoke.
   */
  acquire: SonioxSessionMatrixInput;
  /**
   * STT role the speaker leg runs, or null when no speaker leg starts.
   * `mix_stt` in shared Both — that stream carries mic and system audio mixed
   * together, and calling it `spk_stt` would be a lie about which audio source
   * feeds it.
   */
  speakerRole: 'spk_stt' | 'mix_stt' | null;
  /**
   * STT role the participant leg runs, or null when the participant slot is
   * not a Soniox stream of its own. Null in shared Both: there the slot is the
   * speaker core's inert secondary port, which opens no socket, holds no key
   * and therefore has no role and no started bit.
   */
  participantRole: 'par_stt' | null;
}

/**
 * @param input.sonioxSharedBoth  Accepted so this call site reads identically to
 *   `resolveParticipantSlot`'s, and DELIBERATELY NOT READ. The roles below are
 *   derived from the acquire body instead — see the comment on `speakerRole`
 *   for what reading it costs.
 */
export function resolveManagedSonioxWiring(input: {
  speakerWillStart: boolean;
  participantWillStart: boolean;
  textOnly: boolean;
  sonioxSharedBoth: boolean;
  sonioxSplitBoth: boolean;
}): ManagedSonioxWiring {
  const { speakerWillStart, participantWillStart, textOnly, sonioxSplitBoth } = input;

  // Derived from what will ACTUALLY start, not from the mode picker. Both mode
  // with no microphone selected starts the participant leg alone; asking the
  // server for 'both' there mints an spk_stt key (and, with speech output on,
  // an spk_tts key) that nothing ever connects. Keys are an enforcement point —
  // Soniox has no revoke API and a TTS key is valid for the whole granted
  // duration — so an unused key is real exposure, not untidiness.
  const mode: 'speaker' | 'participant' | 'both' =
    speakerWillStart && participantWillStart
      ? 'both'
      : speakerWillStart
        ? 'speaker'
        : 'participant';

  // `bothSplit` is meaningful only for mode === 'both'. Pinned false otherwise
  // so the request body is a function of the mode it declares — a stale `true`
  // from the settings toggle would describe a two-leg session that has one leg.
  const bothSplit = mode === 'both' && sonioxSplitBoth;

  // Both roles are read off `{ mode, bothSplit }` — the body that is about to
  // go on the wire — and NOT off `sonioxSharedBoth`. This function is therefore
  // a mirror of the server's `expandStreamRoles`, which is the only way the two
  // can be proved to agree. It matters because disagreement is punished on both
  // sides and silently: `credentialsFor` throws for a role that was never
  // issued, and `session-started` answers 400 `role_not_issued`, leaving the
  // lease at its ~75-195 s start window while both Soniox keys stay valid.
  //
  // Three combinations where reading `sonioxSharedBoth` gives a different, and
  // wrong, answer — each covered by a test:
  //   - shared Both with no microphone: the body says `participant` (par_stt),
  //     while `sonioxSharedBoth` is still true and would report no participant
  //     role at all. Reachable today for every managed account.
  //   - Both with an 'auto' source: `sonioxBothModePlan` answers neither shared
  //     nor split, the body says bothSplit:false (mix_stt), and
  //     `!sonioxSharedBoth` would name spk_stt.
  //   - shared and split both true: `resolveParticipantSlot` gives the slot its
  //     own client, so it needs a par_stt bundle that `!sonioxSharedBoth` denies.
  const sharedBothOnTheWire = mode === 'both' && !bothSplit;
  return {
    acquire: { mode, textOnly, bothSplit },
    // `mix_stt` for the one mixed stream of shared Both; `spk_stt` whenever the
    // microphone has a stream of its own (speaker-only, and the speaker leg of
    // a split Both).
    speakerRole: !speakerWillStart ? null : sharedBothOnTheWire ? 'mix_stt' : 'spk_stt',
    // Null exactly when the participant audio is folded into the speaker's
    // single stream — which can only happen when a speaker leg exists to fold
    // it into.
    participantRole: participantWillStart && !sharedBothOnTheWire ? 'par_stt' : null,
  };
}

export type ParticipantSlot = 'secondary-port' | 'own-client';

/**
 * Which thing fills MainPanel's participant slot.
 *
 * `secondary-port` is the inert IClient facade `SonioxClient.createSecondaryPort()`
 * returns: its only live method feeds channel B of the SPEAKER's PcmMixer. It
 * belongs to the SHARED Both path and nothing else.
 */
export function resolveParticipantSlot(input: {
  speakerWillStart: boolean;
  sonioxSharedBoth: boolean;
  sonioxSplitBoth: boolean;
  speakerSupportsSecondaryPort: boolean;
}): ParticipantSlot {
  // Split is tested FIRST and explicitly, even though `sonioxSharedBoth` and
  // `sonioxSplitBoth` are complementary by construction today. Taking the
  // secondary port under split would mix the far end into the speaker's single
  // stream, leave the par_stt key unused, and attribute every far-end utterance
  // to the wrong leg — a session that looks entirely healthy. Nothing
  // downstream can detect that, so the guard lives in code rather than in a
  // comment about an invariant somebody may later relax.
  if (input.sonioxSplitBoth) return 'own-client';
  if (
    input.speakerWillStart &&
    input.sonioxSharedBoth &&
    input.speakerSupportsSecondaryPort
  ) {
    return 'secondary-port';
  }
  return 'own-client';
}

/**
 * Connect one leg and, only if that succeeds, tell the backend the leg started.
 *
 * `stt_started_mask` means "this stream is confirmed connected", and the lease
 * releases when every STARTED leg has ended. Setting a bit before the socket is
 * up would make the lease wait on a usage log that can never arrive.
 *
 * The mirror image is deliberate and is what makes the three non-fatal
 * participant failure paths in connectConversation safe under split — loopback
 * permission denied, `createParticipantSessionConfig()` returning null, and the
 * general participant catch. In each of them `connect` is either never reached
 * or rejects, so the par_stt bit is never set, so the lease is never waiting on
 * the participant and releases on the speaker alone.
 */
export async function connectLegAndMarkStarted(steps: {
  connect: () => Promise<void>;
  markStarted?: () => void;
}): Promise<void> {
  await steps.connect();
  steps.markStarted?.();
}

/**
 * Tear both legs down, then signal session end EXACTLY ONCE.
 *
 * `session-end` is a session-level fact, not a per-leg one. It stamps
 * `end_signalled_at`, unpins the voice slot, and starts the reconciler's
 * fast-retry ladder. Sent from a client's own `disconnect()` — where it lived
 * until this change — the SPEAKER's disconnect (which MainPanel runs first)
 * would do all three while the participant leg was still streaming, burning the
 * ladder on a usage log that cannot exist yet.
 *
 * Both nested `finally`s are load-bearing: a leg's disconnect that throws must
 * not strand the other leg's socket, and must not skip the end signal — a lease
 * whose end is never signalled sits until it expires and 409s every subsequent
 * Start for up to an hour. The original rejection is still propagated.
 */
export async function teardownSessionLegs(steps: {
  speaker?: () => Promise<void>;
  participant?: () => Promise<void>;
  afterBothLegs?: () => void;
}): Promise<void> {
  try {
    try {
      await steps.speaker?.();
    } finally {
      await steps.participant?.();
    }
  } finally {
    steps.afterBothLegs?.();
  }
}
