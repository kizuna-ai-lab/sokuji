# Soniox agent text: measurement before merge

Spec §8 (`docs/superpowers/specs/2026-11-05-agent-text-input-design.md`). The phase 1 pull request copies this list and fills in each result. CI runs none of it.

Rig: Linux with PipeWire; a virtual speaker whose output passes a room impulse response and a delay into a virtual microphone; the app run against it with recorded speakers whose script differs from the translations; a Soniox API key of the team's own.

| # | Run | Result |
|---|---|---|
| 1 | Every Soniox region the app and the backend offer (us, eu, jp), each with an own API key and with a temporary key minted the way the backend does (`usage_type: transcribe_websocket`, single use): each check sends `enable_agent_text_input`, one `agent_text` frame and an empty-text `end_of_segment` on `stt-rt-v6`, and expects no error. US was verified for both kinds of key on 2026-11-05; EU and JP need region keys. | |
| 2 | Face-to-face and split Both, echo cancellation on and off, agent text on and off: lines from the app's own voice, and lines translated back | |
| 2a | The flag on with no text sent, against the flag off: recognition of the same script | |
| 3 | Talk-over: recognition errors on turns started during playback | |
| 4 | A deliberate verbatim repeat of a translation just played | |
| 5 | Cost: the same script with and without agent text, from Soniox's usage records | |

While reading run 2's Logs:
- Compare the count of `stt.agent_text` frames with `end_of_segment: true` against the count of translations. Many more ends than translations means queue underruns split utterances.
- For each line from the app's own voice that leaked, check whether its words were sent.
- If either shows a problem, the first change to try is a short grace before ending a segment when the queue drains on its own. A cleared queue still ends its segment at once.

Merge bar:
- [ ] With echo cancellation off, agent text removes at least 80% of the lines from the app's own voice, face-to-face and split Both.
- [ ] Talk-over recognition with agent text is no worse than without it, beyond run-to-run noise.
- [ ] Run 2a shows no change. If it does, the narrow flag rule (§4.3) replaces the broad one before merge.
- [ ] Run 1 accepted in every region and for both kinds of key. If any combination refuses, the flag (and the switch) is limited to where it is accepted before merge: no session in a refusing region or with a refusing kind of key asks for it.
- [ ] The repeat result (run 4) is recorded here, whatever it is.

Sending at play time instead of at enqueue (§5) is not part of this delivery.
