# Soniox agent text: measurement before merge

Spec §8 (`docs/superpowers/specs/2026-11-05-agent-text-input-design.md`). The phase 1 pull request copies this list and fills in each result. CI runs none of it.

Rig: Linux with PipeWire; a virtual speaker whose output passes a room impulse response and a delay into a virtual microphone; the app run against it with recorded speakers whose script differs from the translations; a Soniox API key of the team's own.

| # | Run | Result |
|---|---|---|
| 1 | A temporary key minted the way the backend does accepts `enable_agent_text_input` | |
| 2 | Face-to-face and split Both, echo cancellation on and off, agent text on and off: lines from the app's own voice, and lines translated back | |
| 2a | The flag on with no text sent, against the flag off: recognition of the same script | |
| 3 | Talk-over: recognition errors on turns started during playback | |
| 4 | A deliberate verbatim repeat of a translation just played | |
| 5 | Cost: the same script with and without agent text, from Soniox's usage records | |

Merge bar:
- [ ] With echo cancellation off, agent text removes at least 80% of the lines from the app's own voice, face-to-face and split Both.
- [ ] Talk-over recognition with agent text is no worse than without it, beyond run-to-run noise.
- [ ] Run 2a shows no change. If it does, the narrow flag rule (§4.3) replaces the broad one before merge.
- [ ] Run 1 accepted. If refused, managed sessions leave the flag off (§4.6) before merge.
- [ ] The repeat result (run 4) is recorded here, whatever it is.

Sending at play time instead of at enqueue (§5) is not part of this delivery.
