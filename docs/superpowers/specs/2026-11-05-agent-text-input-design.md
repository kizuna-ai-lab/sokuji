# Soniox agent text input: keep the app's own speech out of recognition

2026-11-05 · desktop first, mobile later

## 1. What this is, and why

When Sokuji reads a translation aloud on a local output (the speakers, or earbuds loud enough to leak) and a microphone is being transcribed at the same time, the microphone hears that speech. Soniox then recognises it as if someone said it. In a one-way session that is a stray line; in a two-way session (face-to-face, shared Both) the stray line is in the other person's language, so it is translated back and read aloud again: a loop.

Soniox STT v6 (`stt-rt-v6`, already the app's model since #685) has *agent text input*: the client sends the text it is about to play, and the model keeps that playback out of recognition while it still hears a person who talks over it.

A probe against the live service (branch `exp/agent-text-probe`, `scripts/dev/agent-text-probe/`) measured it in the worst case: face-to-face, no echo cancellation, the played speech mixed digitally into the microphone 120 ms later at −6 dB, most turns started while the previous translation was still playing.

| Pair | No agent text | Agent text, three timings | No echo at all |
|---|---|---|---|
| zh ⇄ ja, lines from the app's own voice in 3 min | 250 | 3–7 | 1 |
| zh ⇄ en, lines from the app's own voice in 3 min | 146 | 1–2 | 0 |

Without it the session ran away; with it the false lines nearly vanished. Soniox raised no error, and two voices' agent text interleaved on one socket was accepted. Each 3-minute run sent 600–950 characters.

One side effect was seen: a person who says exactly the words just played can be dropped with them. The probe's recordings are the same sentences in every language, so two Japanese turns matched the Japanese translation just read and were lost. Real speech rarely repeats a translation verbatim, but short phrases ("ありがとう", "好的") can.

**Success:** with speech on a local output and no echo cancellation, the app's own voice produces almost no lines and no loops, and a person talking over it is still recognised.

## 2. Decided

- Owner (2026-11-04/05): worth building into the app; **on by default**; available with the user's own key and with managed (Kizuna) sessions alike; its description says it costs a little extra; desktop first, mobile after.
- Owner: skip it where the output is clearly headphones, as a second phase (§6).
- Timing: send each chunk's text when the chunk is queued for playback (§4.2). In the probe this matched the best timing (0.7 s before play) within one line, is the simplest, and sends only text that will play.

## 3. Non-goals

- Ducking, barge-in, or stopping speech when someone talks.
- The browser extension's own playback path beyond what the shared code gives it for free.
- Mobile in this spec's first delivery (§7).
- Changing how echo cancellation works.
- Speech that does not go through the speech queue: replay during a run, voice preview, the test tone. They are short and user-started; they send no agent text.

## 4. Behaviour

### 4.1 When to send, and to which socket

Agent text goes only to an STT socket that transcribes **the microphone**, and only for speech played on a **local outlet** (`me`, `them`, `other` in `src/lib/audio/routes.ts`). Speech that goes only to the virtual microphone (a meeting) never reaches our microphone and is not sent.

| Mode | Local speech | Socket that hears the microphone | Sent |
|---|---|---|---|
| Face-to-face | both voices (`other`, `them`) | the one shared socket | yes, both voices' text |
| Both, shared | `them`, and `me` when "I hear it too" | the one shared socket | yes |
| Both, split (default) | `them`, and `me` when "I hear it too" | the speaker core's socket | **no**: measured 2026-11-05 (§8), it removed few of the app's own lines here and made talk-over recognition worse with echo cancellation on; the socket does not ask for the flag |
| Me | `me` only when "I hear it too" | the speaker core's socket | only with "I hear it too" on |
| Other | `them` | none (no microphone) | no |

A pure function decides this from the session shape, the clip's voice and its outlet, so the table is tested as written.

### 4.2 What, and when

- **Per chunk, at enqueue.** When a speech chunk is queued on a local outlet, send the text of that chunk's range (the range karaoke already uses; `LegSpeech` attaches a provisional one to each chunk). A chunk with no range yet sends nothing; its text goes with the next chunk that has one, so no text is lost.
- **End of a turn.** When a voice's queue goes idle, send `end_of_segment: true` on the socket that received that voice's text.
- **Cut short.** When queued speech is dropped (speech switched off mid-run, a stop, a cleared queue), send `end_of_segment: true` for that voice and nothing more of the dropped text (Soniox: "send what was already played, close the segment, drop the rest").
- **Two voices, one socket.** Allowed; each voice opens and closes its own turns.
- **Socket down.** Text is sent only while the socket is open (Soniox drops it otherwise). A resume opens a new socket; text continues from the next chunk, nothing is replayed.
- **Manual turns (push-to-talk, push-to-translate) (my call).** Text is sent only while the microphone's audio is actually reaching that socket: always in automatic turns, and in a manual mode only while the key is held. With the key up the microphone sends nothing (the shared socket gets silence in its place), so an echo cannot be transcribed and text sent then would only sit at the start of the person's next turn, where it could swallow a repeated phrase. A chunk that started playing with the key up and is still playing when the key goes down is not re-sent; manual modes are rarely used while speech plays.

### 4.3 The socket

- `SonioxSttStream`'s config frame gains `enable_agent_text_input: true` on the socket that transcribes the microphone **only when the switch is on at Start and a leg speaks** (the narrow rule), and never in split Both (§4.1). The switch is a Soniox setting, read when the session's configuration is built at Start; the run offers each chunk's text, and a socket that did not ask refuses it silently, so "flag on, no text" cannot happen and a change waits for the next session. Soniox ends a stream that receives `agent_text` without the flag, and the flag cannot change on an open socket.
- Why narrow: the first design set the flag broadly, on every microphone socket of a session that may speak, so that mid-run changes could take effect from the next chunk. The measurement (§8, run 2a) found that the flag alone, with the app's speech echoing into the microphone under echo cancellation, makes Soniox drop whole turns a person speaks over that speech (20 of 55, against 0 of 45 without the flag). The broad rule would have done that to every session with the switch off. Speech that does not play locally makes no echo; without an echo path the flag alone changed nothing, so "speech plays locally at Start" is not checked.
- `sendAgentText(text, endOfSegment)` sends `{"type":"agent_text","text":…,"end_of_segment":…}` only while open, like `sendAudio`.
- Every frame sent is logged (`stt.agent_text`) in the diagnostic Logs.

### 4.4 The setting

- One switch in the **Soniox settings**, directly below "Shared session in Both mode" (owner, 2026-11-05: only Soniox supports it, and its split-Both state follows the choice beside it): **"Use the read-aloud text to improve recognition"** (owner, 2026-11-05: it does two things, per Soniox's docs — replies are recognized better because the model knows what they answer, and leftover echo of the read-aloud is left out of the transcript), on by default, a Soniox setting kept separately for own-key and managed (Kizuna) Soniox. It shows where the Soniox settings do (Advanced settings). Like the other Soniox settings it is fixed during a session; a change applies from the next one (§4.3). In split Both it shows off, greyed and not adjustable, and its help says why (§4.1); the stored setting is kept for the other modes.
- Its help: "Tells the recognition service what is about to be read aloud, so it recognizes replies better and leaves the read-aloud out of the transcript if your speakers reach the microphone. When speech plays on this computer, this adds a small charge." No number and no currency in the copy (owner, 2026-11-05).
- Cost notes live in the help, not as separate blocks: the managed cost note of "Shared session in Both mode" moved into that setting's help in the same delivery.
- All 30 locales.

### 4.5 Cost

Agent text is billed by Soniox as input text tokens ($4 per million, as context text). Only sessions that play speech locally pay it. The probe's dense conversation sent at most about 20,000 characters an hour; a typical conversation sends less. That is roughly US$0.02–0.05 per hour of speech at most a few cents, beside about US$0.12 per hour for the audio itself. Managed sessions are billed from Soniox's own usage, so the charge reaches users without a billing change.

### 4.6 Managed sessions

The backend mints Soniox temporary keys. A temporary key minted the same way (`usage_type: transcribe_websocket`, single use) accepted `enable_agent_text_input`, an `agent_text` frame and an empty-text `end_of_segment` on `stt-rt-v6` with no error (checked 2026-11-05, US region). §8's run 1 adds the own-key check.

## 5. Risks

| Risk | Detail | Handling |
|---|---|---|
| A repeated phrase is dropped | A person saying exactly the text just played can be removed with it | Measured with an unrelated script and a deliberate repeat (§8); if it bites, narrow the window to the clip's play time |
| Text that never plays | A chunk queued then dropped | Only queued chunks send; a drop closes the segment |
| Wrong socket | Split Both: the participant voice's echo lands on the speaker core | The routing function (§4.1) and its tests |
| Lead varies | Queued behind other speech, text can lead its audio by seconds | Measured; a later change can schedule sends at play time − lead |

## 6. Second phase: skip where the output is clearly headphones

Rule: skip agent text only when the system says the output is headphones; anything unclear still sends. The existing echo monitor is the safety net: if it detects the app's speech in the microphone, agent text is sent whatever the device says.

| Platform | Signal | Where |
|---|---|---|
| macOS | Core Audio transport type; the built-in output's data source (speaker / headphones); a Bluetooth device's class | a small native module in the main process |
| Windows | the endpoint's form factor (speakers, headphones, headset, HDMI…) | the existing Windows helper |
| Linux | PipeWire's device form factor and active port type | system properties, no native code |
| Extension | device names only | always send |

A separate spec and delivery.

## 7. Mobile, later

The mobile app shares `src/providers/soniox/sttStream.ts`. Once the desktop delivery is measured, mobile sends agent text where its route can echo (loudspeaker, or an output with echo cancellation on) and not on headphones, which it can already tell. Face-to-face needs it most.

## 8. Measurement before merge

On a Linux machine with PipeWire, a virtual speaker whose output passes a room impulse response and a delay into a virtual microphone; the app run against it with recorded speakers whose script differs from the translations. Billed to a Soniox API key of the team's own.

1. Both an own API key and a temporary key minted the way the backend does accept `enable_agent_text_input`, an `agent_text` frame and an empty-text `end_of_segment`. Checked in the US region; the owner judged EU and JP the same service and not worth a separate check (2026-11-05).
2. Face-to-face and split Both, echo cancellation on and off, agent text on and off: lines from the app's own voice, and lines translated back.
   2a. The flag on with no text sent, against the flag off: recognition of the same script must not differ beyond run-to-run noise.
3. Talk-over: recognition errors on turns started during playback.
4. A deliberate verbatim repeat of a translation just played.
5. Cost: the same script with and without agent text, compared from Soniox's usage records.

**Merge bar (my call, from the owner-approved step 1 plan):** with echo cancellation off, agent text removes at least 80% of the lines from the app's own voice in both modes; talk-over recognition with agent text is no worse than without it beyond run-to-run noise; run 2a shows no change; the repeat result is recorded in the pull request whatever it is. Sending at play time instead of at enqueue (§5) is not part of this delivery; it becomes a follow-up only if enqueue misses the bar or repeated phrases are dropped often.

## 9. Delivery

1. Phase 1 (§4): one pull request on kizuna-ai-lab/sokuji, with §8's results in it before merge.
2. Phase 2 (§6): its own pull request.
3. Mobile (§7): kizuna-ai-lab/sokuji-mobile, after the shared code is in.
