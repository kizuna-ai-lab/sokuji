# Screen context for the Qwen engine — design

**Status:** approved in conversation by the owner, 2026-10-22, including his rulings after the builder check (§7) and on choosing the source in the settings (§8).
**Scope:** kizuna-ai-lab/sokuji (desktop app and browser extension), with a small part in kizuna-ai-lab/sokuji-backend (budgeting and pricing).

## 1. Intent

Qwen LiveTranslate (`qwen3.8-livetranslate-flash-realtime`) accepts video frames beside the audio. Alibaba
documents this as 视觉增强: what is on screen — names, product terms, on-screen text — becomes context for
recognition and translation. Sokuji today sends audio only, on both Qwen providers: the user's own key
(`qwen_livetranslate`) and the managed `kizunaai_qwen`.

A measured A/B on 2026-10-22 (the figures below are the record; the probe scripts and raw outputs live in
the session's scratch folder, not in the repo): a 58 s Mandarin kickoff speech with nine homophone-trap
proper nouns, translated to English, text only.

| arm | frames | proper nouns right in the transcript | translation |
|---|---|---|---|
| audio only | 0 | 15/18 | "Banai Technology", "Jishiyi", "Queen" |
| relevant slides (title + agenda carrying the terms) | 2 to 117, any cadence | 18/18 | adopted the slide's own renderings: "Kizuna AI Lab", "Sokuji", "Soniox and Qwen" |
| irrelevant slides (weather, canteen menu) | 59 | 10/18 | worse than audio alone |

Every arm was run three times (two for the cadence arms) and each arm's runs were byte-identical. So: the
screen helps a lot when it shows what is being said, it hurts when it shows something else, and the model
keeps earlier frames in context for at least a minute.

**Goal.** When the screen shows the names being spoken — shared slides in a meeting, the presenter's own
deck, a lecture, on-screen captions in a video — the user can let the Qwen engine see that screen, and
the names come out right in both the transcript and the translation.

**Non-goals.** Translating what is written on screen (OCR); any engine but Qwen (Soniox has no video);
webcam frames (the docs mention lips and gestures; untested, privacy-heavy — not in this version);
face-to-face mode (not available with Qwen at all).

**Anti-goals** (the owner's rulings on the failure modes, 2026-10-22):
- Never send a frame of anything the user did not choose: the default is no source, and the user picks one
  area through the picker the platform provides.
- Never leave the user unsure that frames are going out: the indicator is part of the feature, not a nicety.
- Never let the screen path take the session down: a lost source pauses new frames, the translation goes on.
- Privacy is handled by saying exactly what goes where; Kizuna AI never receives the frames.

## 2. What is known about the wire (verified by probes, 2026-10-13 and 2026-10-22)

- A frame is `{"type":"input_image_buffer.append","image":"<base64 JPEG>"}` on the same realtime socket, at
  most 2 per second, at most 500 KB each (the client caps the JPEG at 375 KB, so its base64 stays under the
  server's 500 KB whichever of the two it measures). The server downsamples internally (a 1280×720 slide
  bills as if ~480p).
- Frames are **ignored unless** `session.update` carries `input_modalities: ["audio","video"]`. This field is
  undocumented; the server accepts `["audio"]` or `["audio","video"]`.
- **Declaring video and then sending no frame kills the session**: the server answers
  `error COMMON_ERROR "Video does not allow empty VideoData or placeholder frames"` and produces no
  transcript at all. The kill is about a turn processed with no frame ever: 10 s of declared video with
  no audio and no frame before the first press (push-to-talk) was harmless once the first frame followed the
  first audio (probe P1, 10-22). After the first frame, long gaps are fine: a 7-minute session with a
  5-minute silence after the clip, the last frame re-sent every 60 s, then the clip again, ran without an
  error and kept the slide's renderings in both passes (probe P2).
- **Black frames are accepted, not rejected as placeholders** — and they hurt like any irrelevant picture:
  an all-black first frame followed by the slides scored 18/18, black frames only scored 11/18, below
  audio-only's 15/18 (probes P3, P3b). Hence the blank-frame guard and the last-good-frame keep-alive in §3.
- Orientation does not change the charge: 720×1280 portrait slides at 1 fps billed the same 11,210 tokens
  (probe P4).
- The first frame must follow audio (send it right after the first audio chunk), per the 10-13 probe.
- Billing is **per second of speech in a video-enabled session**, not per frame and not per second of
  wall-clock: 11,210 `video_tokens` for the 58 s clip whether 1, 2, 15, 59 or 117 frames were sent,
  distinct or repeated (≈192 tokens per second of turn audio for 1280×720 input; 142–192 across the
  probes), and the 5-minute silence of probe P2 added none (two passes of the clip billed 23,370, the
  silence between them nothing — silence is free for video as it is for audio). At Singapore's
  image-input price ($0.55 per 1M) that is ≈ $0.38 per hour of speech before K; Beijing bills the same
  token count at ¥3.3 per 1M. The usage log reports it as `input_tokens_details.video_tokens`, which the
  backend already prices as image input (sokuji-backend#114). Portrait frames of the same pixel count
  bill the same (P4); §3.2 bounds the area at 720p's.
- A frame's effect persists: one frame at 0.5 s still steered names spoken 50 s later; a second slide did
  not evict the first.

## 3. The feature, as decided

### 3.1 Switch and source

- A switch **Screen context** on both Qwen providers' settings (Provider tab, under the voice settings;
  the managed twin shares the view). Off by default. Persisted per provider slice
  (`settings.qwenLiveTranslate.screenContext`, `settings.kizunaQwen.screenContext`, boolean).
- The **source** is one capture area chosen through the picker the platform provides (owner's ruling, §7).
  One API serves every desktop platform, `desktopCapturer.getSources`; what it does differs:
  - On Windows, macOS and Linux on X11 it returns every window and screen with a live thumbnail, and
    Sokuji draws the picker from that list (window title, app icon, thumbnail), windows first, whole
    screens after them.
  - On Linux on Wayland it goes through PipeWire and the desktop portal: the OS shows its own dialog, the
    user picks there, and the call returns that single source (Electron documents this). Sokuji shows no
    list on Wayland — only the privacy line and the button that opens the portal — and the portal decides
    what is offered (windows, whole screens).
  - The extension captures the meeting tab (what `activeTab` grants), see §4.
  The privacy line sits above whichever picker appears: *"Everything inside the area you choose is sent to
  Alibaba Cloud's Qwen service, in the region of this session, as pictures — nothing else on your screen.
  Kizuna AI does not receive them."*
- The source is chosen in the settings, before the session (owner's rulings, §8). On the desktop, turning
  the switch on (idle) opens the picker at once: a pick turns the switch on and is shown under it — *"The
  model will see: {name}"* with **Change** and **Clear**; a portal pick says the system asks which window or
  screen when the session starts, with **Change** — and a cancel leaves the switch off. Turning the switch
  off lets the pick go. The extension has no picker: its switch just flips, and the meeting tab is used.
- The pick is kept in memory only, never written to settings (a window id dies with the window; a title
  match is unreliable): it survives from session to session within one app run, and an app restart clears
  it — the switch, which is persisted, then reads *"No window chosen yet: you'll be asked when the session
  starts"* with **Choose…**. This is a choice the user made and sees in the settings; the picker itself
  still never pre-ticks a past choice.
- Start opens the held source without asking. The picker opens at Start only when nothing usable is held:
  nothing was chosen, the picked window is gone (its capture fails to open) or it shows nothing (no first
  frame) — the last two saying why above the list. Its **Start without screen context** turns the switch
  off, so the setting and the run agree, and turning it on again asks again. Every pick made at Start, and
  a Choose again pick that shows a frame, becomes the held pick the settings show.
- In **Both** mode both legs' sessions receive the frames (either side may refer to the screen).

### 3.2 Sending

- When a run starts with a source chosen, the Qwen adapter declares `input_modalities: ["audio","video"]`
  and sends the first frame immediately after the first audio chunk — under push-to-talk, the first chunk
  of the first press. **Without a source it never declares video** (a hard rule in the adapter, pinned by a
  test).
- Thereafter the client samples the source once a second, downscales to a 64×36 grey thumbnail and compares
  it with the last frame sent; a change above a small threshold sends a new frame. Unchanged screens still
  get a keep-alive frame every 60 s (free: billing is per second). Hard caps: ≤ 1 frame/s; the frame is
  scaled to **fit inside 1280×720** (so a portrait or square window never exceeds 720p's area, which is what
  the billing rate was measured on); JPEG quality ~85 (a 720p slide is ~65 KB), re-encoded at 0.7 then 0.5
  and skipped when still over 375 KB.
- Blank frames — all black, or no variance (a minimized or fully covered window) — are never sent.
- Frames are never logged. The Logs panel gets one `frame` event per sent image with its size and the
  reason (`first`, `changed`, `keepalive`) — never pixels.

### 3.3 Losing the source

- If the window closes, yields no pixels, or capture fails, the client stops sampling, the chip turns red
  (*Not available*; in the desktop app its card offers **Choose again**), and the session continues on audio
  alone. While the source is lost the client keeps
  re-sending the **last good frame** every 60 s, so no new pixels leave the machine and the session never
  sits on a declared video modality with nothing behind it. If the same source comes back (same capture id,
  where the platform has stable ids), sampling resumes by itself; otherwise **Choose again** reopens the picker.

### 3.4 The indicator (option D of the mockups, chosen by the owner)

- While a run has screen context on, the session control bar shows a chip beside the microphone waveform
  in the advanced layout: an eye icon, the source's name, and a status dot — green that pulses on each sent
  frame, amber when the screen has not changed for a while (keep-alives only), red when the source is lost.
  *My call:* in the basic layout and the extension's side panel the chip is icon-only (eye + dot) in the
  footer row, with the same card on hover or click.
- Hover or click opens a small card: the last frame sent as a thumbnail, the source name, time since the
  last frame, frames sent this session, and, in the desktop app, a **Choose again** button (the extension
  captures the meeting tab and has nothing to choose again).
- The chip is the required cue. The operating system's own cue — Windows' yellow capture border, Chrome's
  tab icon or sharing strip, macOS's menu-bar recording icon — appears where the platform draws it and is
  not redrawn by Sokuji; a border window that follows another app's window is out of this version.
- No chip when screen context is off or no source was chosen (there is nothing to say).

### 3.5 Billing

- **Own key:** the user pays Alibaba directly; the setup guide states the per-second video charge.
- **Managed (`kizunaai_qwen`):** the session-key request carries `screenContext: boolean`. The backend
  adds the video rate to the session's hourly rate when it is true, with the same arithmetic as the other
  token kinds in `computeQwenBudget` / `qwenRateUsdPerHour`, so the start floor, the grant's duration and
  the published hourly shapes all include it. *My call:* the worst-case constant is **240 tokens/s** (the
  measured 192 plus a quarter's margin, since the rate's dependence on frame area is unprobed), in
  `QWEN_WORST_TOKENS_PER_S` and the client mirror in `kizunaBudget.ts`. `/api/pricing` publishes the add-on
  as its own figure (e.g. `screenContextUsdPerHour`), and the dashboard's pricing card and calculator show
  it. The charge itself needs no change: `video_tokens` are already priced (#114).
- **In the app, words only, no figures** (owner's ruling, §7; the app shows no prices anywhere today, the
  website does): the switch's tooltip says it adds to the charge for every second of speech while it is on,
  that in Both mode each direction's session is billed, and that the rate is on the account's pricing page. The docs print no
  price either, as before.

### 3.6 Copy, docs, privacy

- UI strings in all 30 app catalogs: the switch, its tooltip (what it does, how it is billed, where frames
  go), the picker's privacy line, the chip's three states, the card's labels, the "choose again" line.
- Site docs (sokuji-backend): the Qwen setup guide and the KizunaAI pages describe the feature; the privacy
  policy's Alibaba Cloud entry gains "and, when screen context is on, pictures of the one window, tab or
  screen you chose". Kizuna AI's liability line stays what it is: Kizuna AI does not receive, store or
  process the frames.
- Analytics: `screen_context_on` at run start (source kind: window / screen / tab, platform) and
  `screen_context_lost` — no titles, no pixels.

## 4. Where it lands in the code (the shape, for the plan)

- **Settings/provider:** `QwenSettings.screenContext: boolean` (+ `migrate`), the switch in
  `QwenSettings.tsx` (shared by the managed view).
- **Run shape / contract:** the runner passes an optional `frames?: FrameSource` on the Qwen leg's
  `StartRequest` (`src/lib/contract/adapter.ts`), where `FrameSource` is `{ name, kind,
  subscribe(onFrame: (jpeg: Uint8Array, reason) => void, onLost: () => void, onBack: () => void): () => void }`
  — a leaf the capture layer implements and the adapter consumes. Only the Qwen adapter reads it; every
  other adapter ignores it; the conformance suite pins that an adapter without a source never declares video.
- **Capture, desktop:** one path on every platform: a new IPC `list-capture-sources` calls
  `desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize })` in the main process; the
  renderer draws the picker from the list where there is one (Windows, macOS, X11) and skips straight to
  the single source the portal returns on Wayland; the chosen source id goes to `getUserMedia` with
  `chromeMediaSource: 'desktop'` and `chromeMediaSourceId` (the extension's tab capture uses the same shape with
  `'tab'`; the Windows system-audio capture does not — it goes through electron-audio-loopback's display-media
  handler, which this path never touches). The `<video>`
  → canvas sampler at 1 Hz, the change detector, the blank-frame guard and the JPEG encode are one renderer
  module shared with the extension. macOS needs the Screen Recording permission (reuse the existing check
  and `open-privacy-settings`); on Wayland the `WebRTCPipeWireCapturer` feature must be on, as the docs note.
- **Capture, extension:** the meeting tab's existing `tabCapture` stream gains a video track (a speaker-only
  run, which captures no tab today, opens a video-only capture of the meeting tab when the switch is on);
  frames leave whenever the switch is on and a run is live (owner's ruling, §7). *My call:* the content
  script reports the bounding box of the largest `<video>` element so the frame is cropped to the shared
  screen when there is one; the full tab otherwise. The extension offers the meeting tab only; "my own
  slides in another tab" is desktop-only for now.
- **Adapter:** `session.update` adds the modality when a source is present; the first frame goes out after
  the first `appendAudio`; later frames are sent as they arrive from the source, rate-capped; a `frame`
  event per send for the Logs panel.
- **UI:** the chip and its card in the session control bar (`PanelFooter`, next to the waveform in the
  advanced layout; icon-only in the basic footer row and the side panel), the picker modal, the source-lost
  notice through the existing notice path (a `degraded` event with a `CLIENT_DIAGNOSTICS` code, so the Logs
  panel and the panel notes get it once).
- **Backend:** `screenContext` on the session-key body, the rate add-on in `computeQwenBudget` /
  `qwenRateUsdPerHour` (240 tokens/s), the pricing entry, the dashboard card and calculator.

## 5. Before building, and before shipping

- **Probed 2026-10-22** (owner's go, five sessions on his Singapore key): push-to-talk with video — fine
  (P1); an all-black first frame — fine, black-only frames degrade recognition (P3, P3b); a portrait frame
  — same charge (P4); a 5-minute silent gap with the last frame re-sent every 60 s, then the clip again
  — no error, names still right, the silence unbilled (P2). §3.2–§3.3 stand as written.
- Measure first-word latency with and without video on the same clip (the A/B measured accuracy only). If
  video costs latency, the switch's tooltip and the docs say so.
- Live tests: Windows (yellow border, VB-CABLE present), macOS 15 (system picker and the Screen Recording
  permission flow), Linux on Wayland (portal) and X11 (Sokuji's list), the extension with a shared screen
  and with nobody sharing (faces and a grid were never measured; if they degrade recognition, the rule in §4
  for the extension is revisited).
- The feature ships behind nothing: it is a switch, off by default, on two providers that are themselves
  gated as today (own key: unflagged; managed: flagged until its release).

## 6. Left to the builder

- The change-detection threshold and thumbnail size (start at mean absolute difference > 6/255 on 64×36)
  and the blank-frame test (flat: variance ≈ 0 on the 64×36 grey thumb (black is flat); a dark slide with a
  bright title is not blank).
- The exact chip and card styling within the settings-control dialect (28 px rows, `#ccc`).
- How Sokuji's own picker lists sources (title + app icon + thumbnail; windows before screens; Sokuji's own
  windows filtered out).
- Test fixtures: a fake `FrameSource` for the adapter's conformance and session-side tests; a recorded
  probe usage row with `video_tokens` for the budget arithmetic.

## 7. Owner's rulings after the builder check (2026-10-22)

1. **Linux is in scope, through the platform's picker.** Electron's capture works on all three OSes; where
   the OS supplies a picker (Wayland's portal, macOS 15+), the user picks there and Sokuji offers whatever
   that picker offers — windows or whole screens; where it does not, Sokuji's own list. The "no whole
   screen" rule from the first draft is replaced by the privacy line and the user's own choice.
2. **The extension sends frames whenever the switch is on**, in any run shape, not only while a screen
   share is detected. The risk that a camera grid degrades recognition is accepted for now and measured in
   the live tests (§5).
3. **No price figures in the app.** The app shows none today (the only cost words are the managed Soniox
   shared-session tooltip's "about twice the cost per minute"); the website's pricing page and calculator
   carry the figures. The switch's tooltip uses words.

Calls I made without asking, for review while reading: §3.2 fit inside
1280×720 and the blank-frame guard; §3.3 re-sending the last good frame while lost; §3.4 icon-only chip in
the basic layout and the side panel, no border window; §3.5 the 240 tokens/s constant; §4 the extension
crop to the largest video element and meeting-tab-only; §5 the pre-build probes.

## 8. Owner's rulings on choosing the source in the settings (2026-10-22)

1. Turning the **Screen context** switch on (desktop, idle) opens the picker at once. A pick turns the switch
   on and is shown under it with **Change** and **Clear**; a cancel leaves the switch off. The extension has
   no picker: its switch just flips (the meeting tab is used).
2. Start no longer asks when a usable pick is held: it opens that source. Only when the picked window is gone
   (its capture fails to open) or shows nothing (no first frame) does the picker open at Start, saying why.
3. **Start without screen context** in the Start-time picker turns the switch off (the setting and the run
   agree); turning it on again asks again.
4. The pick is kept in memory only — never written to settings — and survives across sessions within one app
   run; an app restart clears it. This does not contradict "never preselect": that was about the picker
   pre-ticking a past choice; this is a choice the user made and sees in the settings.
5. The chip and Choose again stay; a Choose-again pick also becomes the held pick shown in the settings.
