/**
 * The other party's voice for a run: the choice, unless it is the speaker's
 * own — then whichever of the provider's two defaults the speaker is not
 * using, so the two people never sound alike.
 */
export function distinctVoice(chosen: string, speaker: string, defaults: { participant: string; speaker: string }): string {
  if (chosen !== speaker) return chosen;
  return chosen === defaults.participant ? defaults.speaker : defaults.participant;
}
