# India region, region recommendation, and the voice warning — Client design

**Status**: proposed.
**Repos**: `kizuna-ai-lab/sokuji` (this document — desktop app and browser extension, which share `src/`),
`kizuna-ai-lab/sokuji-backend` (companion `docs/superpowers/specs/2026-11-14-soniox-india-region-design.md`: the
backend half of the India region). Mobile is out of scope (later, by others).
**Builds on**: `2026-08-15-soniox-regions-design.md` and the Qwen Beijing region client plan. Their decisions stand,
except that "automatic region selection is out of scope" is now partly lifted: the app **recommends**; it still never
switches on its own.

## Why

Users stay on the default region. Over the last 30 days 476 accounts used managed Soniox's US region, 48 EU and 28 JP,
while about 39% of our users are in East Asia, where Japan answers in ~10–40 ms and the US in ~170 ms. A user who never
opens Advanced → Provider never finds out. jiangzhuo wants the app to measure the user's own network once, show how fast
each region is, and recommend the best one — the user decides. At the same time Soniox gains an India region, and a
region change can silently cost a user their custom voice, so every region change should warn when that is at stake.

## Goals

1. **India (`in`) as a fourth managed and own-key Soniox region**, usable end to end.
2. **A one-time region recommendation per regional provider**, measured on this device:
   - managed Soniox (`kizunaai_soniox`): among its regions — today us / eu / jp / in;
   - managed Qwen (`kizunaai_qwen`): among its regions — today sg / cn.
   The recommendation never crosses providers, and a region added to a provider later joins its measurement
   automatically.
3. **A warning before any Soniox region change** when the user has a custom voice in the current region — whether
   they change it in the select or from the recommendation.
4. **No more stale custom voice ids** after an account or region change (D).

## Non-goals and anti-goals

- **Never switch a region automatically.** Only the user's click changes it. (jiangzhuo, explicit.)
- Never measure more than once per provider per device; never show the hint during a session or when the best region
  is the one the user already has; once the user acts on the hint (chooses or closes), never show it again.
- No modal pop-up for the recommendation itself: a small dismissible hint; the full region list opens only on request.
- Never recommend for own-key providers: an own key belongs to one region's project, so another region is not usable.
- No price in the recommendation (jiangzhuo, explicit).
- No re-measuring on network changes, no background re-probing, no server-side choice.
- Mobile.

## What is true today (origin/main `b4be845ac`, v0.50.2)

- `src/lib/soniox/regions.ts`: `SonioxRegion = 'us'|'eu'|'jp'`, `SONIOX_REGIONS`, `DEFAULT_SONIOX_REGION = 'us'`,
  `SONIOX_REGION_LABELS` (plain strings, not locale keys), `sonioxHosts(region)` (the only host builder),
  `asSonioxRegion(value, fallback)`. Qwen's twin is `src/providers/qwen_livetranslate/regions.ts` (`sg`|`cn`, default
  `sg`, labels `'Singapore'`, `'北京 (Beijing)'`); its hosts are in `endpoints.ts`
  (`maas.qwencloudapi.com` for sg, `maas.qianwenaiapi.com` for cn).
- `src/providers/soniox/settings.ts`: per-region fields `apiKey/apiKeyEu/apiKeyJp`, `voice/voiceEu/voiceJp`.
  **`sonioxKeyField` and `sonioxVoiceField` are chained ternaries ending in the JP field**, as are `REGION_OF_KEY` and
  `sonioxSpeakerVoice`: adding `'in'` to the type alone compiles and silently uses the Japan key and voice. New fields
  must be added to both `SONIOX_DEFAULTS` and `migrateSonioxSettings` (which builds an explicit object).
- Session start (`leaseRequest.ts`, `lease.ts`): the request carries the region; the response region is authoritative
  and an unknown response region throws. Old clients therefore must never be answered with `in` — the backend only
  echoes what was asked, so they never are.
- Region select: `src/providers/soniox/SonioxSettings.tsx` `onChange={(e) => update({ region: … })}`, no side effects;
  disabled during a session, but `providerStore.updateSettings` itself has no lock.
- A cloned voice is a UUID in the region's voice field; built-in voices are names (`SONIOX_VOICES`). The check exists
  inline in `voiceClaim.ts` (`BUILT_IN` set) and `SonioxVoiceSummary.tsx`. Managed Start rebuilds a missing voice in the
  new region from this device's clip (`loadVoiceClip(userId)`); own-key voices live in the user's own project per
  region and are never rebuilt.
- One-time modal precedent: `VbCableIntro` + `vbCableStore` (`audio.vbCableIntroSeen`, `persistSetting`), waiting for
  the tour to finish. `SettingsService` uses `chrome.storage.sync` in the extension (syncs across the user's browsers)
  and `localStorage` in Electron.
- Extension CSP (`extension/manifest.json` `connect-src`) already allows `https://` to every `tts-rt.*` host and to
  both Qwen `maas.*` hosts; India hosts are missing.
- Nothing measures latency today.

## Measurement findings that shape the design

Measured 2026-11-14 from Tokyo and through proxy exits in Taiwan, Hong Kong, Singapore, the US (Los Angeles), Germany,
the UK and India (raw data in task #77's research notes):

- Soniox's real-time hosts (`stt-rt.*`, `tts-rt.*`) for **all** regions resolve to the same Cloudflare anycast
  addresses. TCP or TLS connect time is identical for every region (~4 / ~13 ms) and useless. A full HTTPS request goes
  through Cloudflare to the region's servers; its time ranks regions correctly from every vantage point tested.
  Soniox's `api.*` hosts are AWS us-east-1, eu-central-1, ap-northeast-1, ap-south-1.
- Qwen's `maas.*` hosts are in-region Alibaba Cloud (Singapore; Beijing) with no CDN. Beijing has IPv6 as well as IPv4;
  from Japan **Beijing over IPv6 takes ~150 ms against ~80 ms over IPv4**, and browsers prefer IPv6. Outside mainland
  China, Beijing is slow (300–400 ms) or unreachable.
- A proxy/VPN adds the same delay to every region, so a **relative** threshold suppresses correct recommendations
  (Germany exit, current US: EU 101 ms faster but < 30 %). An **absolute** threshold works everywhere tested.
- In a real Chromium page, `fetch(url, { mode: 'no-cors' })` works and is timeable; each 404 prints a harmless console
  error.

## Approaches considered

1. **Client measures, client recommends** — chosen by jiangzhuo. Measures the user's real path, including proxies and
   the IPv6 route; no backend involvement.
2. Server-side geography (Cloudflare country/coordinates on our Worker). Instant, but geography is not the network
   path (proxies, the IPv6 route to Beijing), and it cannot see what the session will see. Rejected.
3. Both. Twice the code for a measurement taken once. Rejected.

## Design

### A. India region (Soniox)

1. `regions.ts`: `SonioxRegion` gains `'in'`; `SONIOX_REGIONS = ['us','eu','jp','in']`; label `'India'`
   (*Anne's call*: English is an official language of India, consistent with the "named in its own language" rule);
   `sonioxHosts('in')` yields `api.in.soniox.com`, `stt-rt.in.soniox.com`, `tts-rt.in.soniox.com` with no new code.
2. `settings.ts`: add `apiKeyIn` and `voiceIn` (defaults as for EU/JP), add them to `SONIOX_DEFAULTS` and
   `migrateSonioxSettings`. **Replace the chained ternaries** (`sonioxKeyField`, `sonioxVoiceField`, `REGION_OF_KEY`,
   `sonioxSpeakerVoice`) with exhaustive `Record<SonioxRegion, …>` maps, so a fifth region fails to compile instead of
   reusing Japan's fields.
3. `extension/manifest.json` CSP `connect-src`: add `https://api.in.soniox.com`, `wss://stt-rt.in.soniox.com`,
   `wss://tts-rt.in.soniox.com`, `https://tts-rt.in.soniox.com`; update `manifest.consistency.test.ts`.
4. Everything else (lease, streams, managed voice per region, own-key key check and cloning) already follows
   `sonioxHosts(region)` and the region-keyed fields. Tests prove it for `in`.

### B. Region recommendation

#### B1. Which providers, which hosts

A small table, one entry per regional managed provider, so adding a region or a provider is one entry:

| Provider id | Regions | Probe URL per region | Settings field read/written |
|---|---|---|---|
| `kizunaai_soniox` | `SONIOX_REGIONS` | `https://${sonioxHosts(r).ttsRt}/` | `kizunaSoniox.region` |
| `kizunaai_qwen` | `QWEN_REGIONS` | `https://<maas host of r>/` (from `endpoints.ts`) | managed Qwen's `region` |

`tts-rt` rather than `stt-rt`: equally clean in measurements, already allowed by the extension CSP and CORS-open. Qwen
uses the same host its session socket dials.

#### B2. When it runs

All of:
- the selected provider is one of the table's providers;
- this device has no recommendation record for that provider (B4);
- the user is signed in, setup/tour is finished, the run phase is `idle`, and `navigator.onLine`;
- about 5 s after the main screen mounts, in the background.

It runs **in the renderer** (the same Chromium network stack, proxy settings and IPv4/IPv6 choice as the session), never
in Electron's main process or a separate client — otherwise it would not see the IPv6 route a session to Beijing takes.
If the user switches to the other regional provider later, that provider gets its own measurement on its own terms.

#### B3. How it measures

Per provider, all regions in parallel:
1. **Warm-up round**: one request per region, results discarded (DNS, TCP, TLS).
2. **Five rounds**, 200 ms apart, one request per region per round; each request
   `fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' })` with a 3 s `AbortController` timeout,
   timed with `performance.now()` around the awaited fetch.
3. Per region, the **median** of its successful samples; a region with fewer than 3 successes is *unmeasured*.

About 3 s and 4 × 6 small requests (Soniox) or 2 × 6 (Qwen), once per device per provider. The requests carry no key,
no audio and no account data.

#### B4. The decision and the record

- `best` = the measured region with the lowest median.
- **Recommend** when `best ≠ current` and (`current` is unmeasured, or `median(current) − median(best) ≥ 50 ms`).
  Absolute, not relative (see findings). 50 ms is a named constant.
- Record per provider **on this device only** — `localStorage` in both the app and the extension pages, not
  `SettingsService` (which syncs across the user's browsers in the extension; a measurement belongs to one network).
  Shape: `{ status: 'hint' | 'acted' | 'no-change' | 'gave-up' | 'chose-manually', medians?, recommended?, at,
  attempts }`.
  - measurement succeeded and recommended → `hint` (with the medians and the recommended region, so the hint and the
    list can be shown on later launches without measuring again); when the user chooses a region from the list or
    closes the hint → `acted`;
  - measurement succeeded and nothing to recommend → `no-change` (no hint);
  - every region unmeasured (offline, blocked) → keep `attempts`, retry on the next app start; after **3** failed
    attempts → `gave-up`;
  - the user changes that provider's region by hand at any time → `chose-manually` (no measurement afterwards).
  Any record means "never measure again" for that provider on this device.
- **Existing users are all measured once**, whatever region they have stored: a stored region cannot tell "chose it"
  from "kept the default", and one small, dismissible hint is acceptable (jiangzhuo). Users who chose a region for
  data residency simply close the hint.

#### B5. The hint and the region list

Not a pop-up (jiangzhuo: "maybe not a pop-up, just a small hint"). Two layers:

1. **A small dismissible hint strip at the top of the main panel** — a `Banner` rendered by `<Banners />` in
   `MainPanel.tsx`, the same place and style as the "update available" strip; not a modal — e.g.
   "Japan is about 160 ms faster than your current region (United States) · See each region's speed".
   It appears only when there is something to recommend, never during a session, and stays (across launches) until
   the user acts on it: opening the list and choosing, or closing the hint (= keep the current region). Its pending
   state is part of the device-local record (B4) — the `Banner` system's own dismissals last one session only.
2. **The region list**, opened from the hint: a `Modal` showing every region of the provider with its median, the
   recommended one marked, the current one labelled:

```
Choose a faster region                                      (×)
We measured your connection to each Soniox region:
  ● Japan          13 ms   Recommended        [Switch]
    India         136 ms                      [Switch]
    United States 177 ms   Current
    European Union 237 ms                     [Switch]
                                   [Keep United States]
```

- Each non-current measured row has its own button: the user may pick any region, not only the recommended one
  (jiangzhuo, explicit). Unmeasured regions show "Couldn't reach" and no button.
- **Beijing row note** — *Anne's call, for jiangzhuo to keep or drop*: "Data is processed in mainland China." No price.
- Choosing a row goes through the same region-change path as the settings select (C), so the voice warning applies.
- Closing (×, backdrop, "Keep …") keeps the current region. The record is written either way.
- Copy is in the 30 client catalogues; region names stay the existing `*_REGION_LABELS`.

#### B6. Analytics — *Anne's call*

One event when the hint is resolved (the user chooses or closes it), or when the measurement decides nothing:
`region_recommendation` with `provider`, per-region medians, `current`, `recommended`, and `outcome`
(`switched` / `kept` / `no_change` / `gave_up`) plus `chosen`. No IP, no account fields beyond what analytics already
carries. Purpose: check from the field that recommendations are right and how many are accepted.

### C. The voice warning on a Soniox region change

One function, `requestSonioxRegionChange(provider, from, to)`, used by both the settings select and the region list's
buttons:

1. If the **current** region's voice field (`sonioxVoiceField(from)`) holds a custom voice (not a built-in name — move
   the `BUILT_IN` check from `voiceClaim.ts` into a shared helper), show a confirm `Modal` before changing anything.
   The text says what really happens: **a voice does not follow a region change.** Each region has its own voice field
   and slot; nothing copies `voice*` across regions, and `voiceClaim` only rebuilds a clone already named in the new
   region's own field. So:
   - {to}'s field holds a built-in voice (the usual case): "Your custom voice is saved in the {from} region and can't
     be used in {to}. Sessions in {to} will use the built-in voice {name} until you create a custom voice there.
     Your {from} voice stays; switching back to {from} uses it again."
   - {to}'s field already holds the user's own custom voice: "Sessions in {to} will use the custom voice you created
     there. Your {from} voice stays in {from}."
   - Own-key wording is the same, naming the user's own Soniox project instead of the managed voice.
   Buttons: "Switch to {to}" / "Cancel".
   *Anne's call, from jiangzhuo's request for a reminder only:* the switch does **not** copy the voice into {to}
   (which would make the next Start upload the device clip and build a paid voice there). Carrying a voice across
   regions is a separate feature if wanted.
2. On confirm (or when there is no custom voice), write the region; if the change came from the settings select, also
   write the provider's recommendation record as `chose-manually`.
3. The change is refused while a session runs (`currentRunPhase() !== 'idle'`) — the select is already disabled then;
   this also guards the region list.

A stale UUID (evicted on Soniox) still triggers the warning; that is harmless. Qwen has no custom voices; its region
change has no warning.

### D. Stale custom voice ids (bug, fixed together with C — jiangzhuo)

**Symptom.** After switching account or region, the Soniox voice setting can still hold a cloned voice's UUID that
the current account (or key) does not own in that region. Start then falls back, and the voice list shows
"(deleted voice)".

**Root causes** (origin/main `b4be845ac`):
1. The voice fields are stored **per device** (`settings.kizunaSoniox.voice*`; `chrome.storage.sync` in the extension,
   so per Chrome profile), but a clone id is only valid for one (account, region) — backend slots are
   `PRIMARY KEY(account_id, region)` — or one (own key, region).
2. Nothing reconciles the id: `migrateSonioxSettings` accepts any string; sign-out/sign-in and region changes leave it.
3. At Start, managed `clip_required` with no clip on this device falls back to `SONIOX_DEFAULT_VOICE` **for that run
   only** (`voiceClaim.ts`, `resolveVoicePrepOutcome`), so it repeats every Start. Own key has no fallback at all: TTS
   is rejected and speech stops for the session.
4. `SonioxVoiceSection` deliberately keeps an externally deleted id and renders a disabled "(deleted voice)" entry.
5. Side bug: deleting the managed voice calls `clearVoiceClip()` without an account, wiping another account's clip on
   a shared device.

**Fix.**
1. **One pure helper**, `reconcileSonioxVoice(stored, ownedVoices, hasDeviceClip)`: keep a built-in name; keep an id the
   account/key owns in that region (including one still processing); for managed, keep an unknown id when this
   account's clip is on the device (Start will rebuild it); otherwise return `SONIOX_DEFAULT_VOICE`. Writes use
   compare-before-write (as `persistIfUnchanged`), so a choice the user makes meanwhile is never overwritten.
2. **When it runs** (signed in, online, field not built-in), for the region's own field only:
   - on an **account change** (the existing `signInWatchers` / `userId` change) — managed: `mine()` for the new account;
     if it owns a voice in that region, write its `voiceId`, else reconcile;
   - on a **region change** (C) for the new region's field — managed `mine()`, own key `SonioxVoicesClient.list()`;
   - after the Settings voice list loads authoritatively (`listState === 'idle'`);
   - at **Start**, managed `clip_required` with no device clip now also **persists** the default voice (other
     fallbacks — pool exhausted, unavailable, voice failed — stay per run: they may recover).
   A list that failed to load, or offline, proves nothing: never reset then.
3. **No more "(deleted voice)" entry.** After reconciliation there is nothing to show; while a list is loading or has
   failed, a non-built-in id is labelled neutrally ("Custom voice").
4. **Own key** gets the same reconciliation — *Anne's call*: it reverses the documented "never rewrite an externally
   deleted voice" policy, which is exactly what produces this bug, and own-key users today lose all speech output for a
   session instead of hearing the default voice.
5. **`clearVoiceClip(userId)`** only clears the clip of the account deleting its voice.
6. `sonioxVoiceField` is exhaustive (A2), so no region shares another's field.

**Accepted trade-off (extension):** the voice fields sync across a user's Chrome browsers. If device A (no clip) resets
an id that device B could have rebuilt from its clip, device B loses the automatic rebuild. The account has no voice
in that region either way; B's user picks the voice again (the clip is still on B). Making voice fields device-local is
a larger change, not done here.

## Testing

Test-first (Vitest), pure logic separated from the UI:

- `regions.test.ts`: India hosts (and the negative `in.api…`), label present, `asSonioxRegion('in') === 'in'`.
- `settings.test.ts`: the key and voice field maps are exhaustive over `SONIOX_REGIONS` (`in → apiKeyIn / voiceIn`,
  never the JP fields); migration keeps `apiKeyIn`/`voiceIn`.
- `extension/manifest.consistency.test.ts`: India origins present.
- Probe (fetch injected): warm-up discarded; median of 5; a region with < 3 successes is unmeasured; timeouts abort.
- Decision table: recommend / no-change at 49 and 50 ms; current unmeasured; all unmeasured → retry, third → gave-up;
  a manual change writes `chose-manually`; a record suppresses any further measurement.
- Gating: not during a session, not before sign-in/tour, not for own-key providers, only for the selected provider.
- Region list: lists every region with its median, marks recommended and current, one button per measured non-current row,
  Beijing note, keep/close writes the record and changes nothing.
- Voice warning: shown when {from} holds a custom voice (managed and own key), not for a built-in voice; the text
  names {to}'s built-in voice, or {to}'s own custom voice when it has one; cancel changes nothing; confirm changes
  only the region (no voice field is copied); used by both the select and the region list.
- Stale voice ids: `reconcileSonioxVoice` table (built-in kept; owned kept; processing kept; unknown + device clip
  kept; unknown, no clip → default; list error → unchanged); account change writes the new account's voice or the
  default; region change reconciles the new field; Start `clip_required` without clip persists the default; no
  "(deleted voice)" entry is ever rendered; own key reconciled after `list()`; `clearVoiceClip` only clears the
  deleting account's clip; compare-before-write never overwrites a newer user choice.
- Existing users: no record → measured once, whatever region is stored.
- Hint: shown only with something to recommend; persists across launches until acted on; closing it = keep, writes
  the record; opening it shows the region list.
- Manual: Tokyo direct and the proxy exits used in research; an IPv6 machine with Qwen Beijing current (expect
  Singapore recommended from Japan).

## Rollout

1. Backend (companion spec) deployed and `SONIOX_API_KEY_IN` set.
2. The backend's privacy texts (India, and the speed-test disclosure — companion spec decisions 7 and 8a) are live.
3. Client release with A + B + C + D. Existing users have no record, so each gets one measurement — and a hint only
   if a region is ≥ 50 ms faster than theirs.
3. After release, read the `region_recommendation` events for a week.

## Left to the builder

Component names and file layout; how the provider table reads managed Qwen's region field; the exact 5 s delay hook
(next to `VbCableIntro` in `MainLayout`, or `AppSessionRoot`); copy wording within the meaning above; whether the probe
module is shared with mobile later (it should be platform-neutral `src/lib/` code with injected `fetch`/clock).
