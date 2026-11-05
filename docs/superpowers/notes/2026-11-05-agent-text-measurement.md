# Soniox agent text: measurement before merge

Spec §8 (`docs/superpowers/specs/2026-11-05-agent-text-input-design.md`). The phase 1 pull request copies this list and fills in each result. CI runs none of it.

Rig: Linux with PipeWire; a virtual speaker whose output passes a room impulse response and a delay into a virtual microphone; the app run against it with recorded speakers whose script differs from the translations; a Soniox API key of the team's own.

Measured 2026-11-05 with the branch build of the real desktop app:
- **Room:** the app's speakers feed a synthetic room (120 ms delay, −6 dB, RT60 0.4 s) that feeds the microphone.
- **People:** two recorded people with disjoint sentence sets, zh ⇄ ja and zh ⇄ en. Most turns start while the previous translation is still read aloud.
- **App settings:** noise suppression at the app's default (enhanced); outlets at the default (auto). Echo cancellation "off" is forced at the microphone request: users cannot turn it off.
- **Volume:** 52 scored runs, 126 min of Soniox audio.

| # | Run | Result |
|---|---|---|
| 1 | An own API key and a temporary key minted the way the backend does (`usage_type: transcribe_websocket`, single use), in the US region: each check sends `enable_agent_text_input`, one `agent_text` frame and an empty-text `end_of_segment` on `stt-rt-v6`, and expects no error. EU and JP are not tested separately: the owner judged them the same service as US (2026-11-05). | Accepted, both kinds of key (2026-11-05) |
| 2 | Face-to-face and split Both, echo cancellation on and off, agent text on and off: lines from the app's own voice, and lines translated back | **Echo cancellation off:** face-to-face 51 → 1 lines from the app's own voice (98% removed; zh ⇄ ja 23 → 0 and 24 → 0, every one read again without agent text). Split Both 24 → 15 (38%). **Echo cancellation on:** 0 lines in every run with agent text; without it, 0–2 lines per condition. |
| 2a | The flag on with no text sent, against the flag off: recognition of the same script | **Without an echo path:** no change (CER 0.014–0.019, 16/16 turns either way). **With the echo path and echo cancellation on (face-to-face):** the flag alone drops whole talk-over turns, 20 of 55 against 0 of 45 without the flag. Every lost turn reached Soniox at normal level. So the narrow flag rule replaced the broad one (§4.3). |
| 3 | Talk-over: recognition errors on turns started during playback | **Face-to-face, echo cancellation on:** with agent text, CER 0.075 on recognized turns and 2 of 58 turns lost. Without the flag, 0.086 and 0 of 45 lost. That is no worse beyond the run-to-run spread. **Face-to-face, echo cancellation off:** 0.152 with agent text against 0.256 without. **Split Both, echo cancellation on:** with agent text, 0.128 against 0.073 with the flag and no text; every run with agent text was worse. So split Both sends none (§4.1). |
| 4 | A deliberate verbatim repeat of a translation just played | Face-to-face zh ⇄ ja, echo cancellation off, agent text on: all 3 repeats were recognized in full, 0.2–0.7 s after the read-aloud ended. None was dropped. |
| 5 | Cost: the same script with and without agent text, from Soniox's usage records | **Agent text:** US$0.036–0.038 per hour of face-to-face audio, from `input_agent_text_cost_usd` in Soniox's usage logs. That compares with about $0.06/h for the audio itself. **A looping session (zh ⇄ ja, echo cancellation off):** agent text saved more than it cost. STT came to $0.0050 against $0.0069, and TTS to $0.0085 against $0.0174. |

While reading run 2's Logs:
- Compare the count of `stt.agent_text` frames with `end_of_segment: true` against the count of translations. Many more ends than translations means queue underruns split utterances.
  - **Result:** 12–18 ends for 13–18 translations face-to-face, 8 for 8 in split Both. No queue underrun split an utterance.
- For each line from the app's own voice that leaked, check whether its words were sent.
  - **Result:** every leaked line had its words sent 0.18–1.6 s before it played.
- If either shows a problem, the first change to try is a short grace before ending a segment when the queue drains on its own. A cleared queue still ends its segment at once.

Merge bar:
- [x] With echo cancellation off, agent text removes at least 80% of the lines from the app's own voice, face-to-face and split Both. Face-to-face: 98%. Split Both: 38%, so split Both sends none (§4.1).
- [x] Talk-over recognition with agent text is no worse than without it, beyond run-to-run noise. Face-to-face: yes. Split Both was worse and is excluded.
- [x] Run 2a shows no change. If it does, the narrow flag rule (§4.3) replaces the broad one before merge. It changed with an echo path, so the narrow rule is in.
- [x] Run 1 accepted for both kinds of key. If a region later refuses the flag, the flag (and the switch) is limited to where it is accepted: no session there asks for it.
- [x] The repeat result (run 4) is recorded here, whatever it is.

Sending at play time instead of at enqueue (§5) is not part of this delivery.
