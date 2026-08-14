# Soniox regional endpoints (EU / JP) — Design

**Status**: proposed.
**Repos**: `kizuna-ai-lab/sokuji` (client — this document), `kizuna-ai-lab/sokuji-backend`
(managed lease, key issuance, voice slots, reconciler — companion document
`docs/superpowers/specs/2026-08-15-soniox-regions-design.md` in that repo).

## Why

Soniox runs three regional deployments. Today Sokuji dials the US/global one and only the
US/global one: five hardcoded hostnames across the client, one hardcoded `API_BASE` in the
backend.

Users who need their audio to stay in the EU or in Japan cannot use Sokuji's Soniox
provider at all — not as a degraded experience, but not at all, because a US-region key
does not authenticate against the US host on their behalf and a regional key does not
authenticate against the US host either. Regional projects are separate projects with
separate keys, so the region is not a routing preference; it is part of the credential.

This applies to both flavours: BYOK Soniox (the user's own regional project key) and
Kizuna AI managed Soniox (our project keys, one project per region).

## What is true today

Load-bearing facts, verified rather than assumed. Each one constrains the design.

### The regional hostnames

Verified against `soniox.com/docs/data-residency` and confirmed by DNS resolution of every
name below on 2026-08-15:

| Region | REST API | Real-time STT | Real-time TTS |
|---|---|---|---|
| US (global) | `api.soniox.com` | `stt-rt.soniox.com` | `tts-rt.soniox.com` |
| EU | `api.eu.soniox.com` | `stt-rt.eu.soniox.com` | `tts-rt.eu.soniox.com` |
| JP | `api.jp.soniox.com` | `stt-rt.jp.soniox.com` | `tts-rt.jp.soniox.com` |

The shape is `<service>.<region>.soniox.com`, with the US deployment carrying **no**
infix. The plausible-looking alternative `eu.api.soniox.com` does **not** resolve
(NXDOMAIN), so the infix position is not a free choice and a test pins it.

### Keys are region-scoped

The docs state data residency is set "per project within your Soniox organization" and
"each project receives region-specific API keys". A region is therefore a property of the
credential, not a routing hint layered on top of one. A key from the EU project is
rejected by `api.soniox.com`, and vice versa.

Two consequences the design has to respect:

- A user can hold up to three unrelated BYOK keys. Storing one and reinterpreting it when
  the region changes would silently make a valid key look invalid.
- Anything minted *from* a project key — temporary session keys, cloned voices — belongs
  to that project and does not exist in the others.

### The five client-side hostnames

| File | Constant | Used for |
|---|---|---|
| `src/services/clients/SonioxSttStream.ts` | `STT_URL` | session STT+translation WebSocket |
| `src/services/clients/SonioxTtsStream.ts` | `TTS_URL` | session TTS WebSocket |
| `src/services/clients/SonioxTtsRest.ts` | `TTS_REST_URL` | voice-preview one-shot synthesis |
| `src/services/clients/SonioxVoicesClient.ts` | `VOICES_URL` | BYOK voice cloning (`/v1/voices`) |
| `src/services/clients/SonioxClient.ts` | `AUTH_PROBE_URL` | BYOK API-key validation |

### Credentials already have a carrier the store keys its cache on

`Credentials` (`src/services/providers/ProviderDescriptor.ts`) is
`{ ok: true; primary: string; secret?: string; endpoint?: string }`. `settingsStore`
builds its validation cache key as
`` `${provider}:${creds.primary}:${creds.secret ?? ''}:${creds.endpoint ?? ''}` ``, and
`ClientOperations.validateApiKeyAndFetchModels` reconstructs `endpoint` on the way into
the descriptor. The field survives the whole round trip.

### The managed session already carries per-leg credentials

`SonioxCredentialBundle` (`src/services/clients/ManagedSonioxSession.ts`) is what a
`SonioxClient` runs on: `{ stt, tts?, clientReferenceId? }`. `ManagedSonioxSession`
files one bundle per transcription leg, and a split Both session runs two clients with
two different bundles simultaneously.

### Settings persistence is flat and per-field

`updateProviderSlice` writes each field individually under `settings.<sliceKey>.<field>`,
and `loadSettings` reads back exactly the keys present in the slice's defaults object.
Adding a field to the defaults makes it load; it does not disturb existing stored keys.

### Only six places read the Soniox API key

`ProviderSection.tsx:324` (the generic key setter), `ProviderSpecificSettings.tsx:268-271`
(the voice-library client), the base `extractCredentials`/`peekPrimaryCredential`, and the
`kizunaSoniox` slice's `neverPersist: ['apiKey']` entry. The blast radius of changing the
storage shape is small and enumerable.

## Decisions taken

Recorded because the reasoning is not recoverable from the resulting code.

1. **The region travels with the keys it belongs to**, as a field on
   `SonioxCredentialBundle` — not as a module-level "current region" global and not as
   five separately-threaded URL strings. A split Both session runs two clients at once;
   a global would be a single mutable cell shared by both legs and by any settings change
   the user makes mid-session. Binding the region to the bundle makes "dial an EU host
   with a US key" structurally unrepresentable rather than merely a bug we test for.
2. **URL shape lives in exactly one module.** `sonioxHosts(region)` is the only place the
   `<service>.<region>.soniox.com` pattern exists in the client. The wire components take
   a region and ask; they do not concatenate.
3. **BYOK stores one key per region, in three flat fields**: `apiKey`, `apiKeyEu`,
   `apiKeyJp`. `apiKey` keeps meaning the US/global key — the field with no region suffix
   pairs with the host with no region infix. This needs **no migration**: existing users'
   stored `settings.soniox.apiKey` keeps loading into the same field with the same
   meaning. A symmetric `apiKeyUs` would have been prettier and would have bought a
   migration for it.
4. **The selected voice is stored per region too** (`voice`, `voiceEu`, `voiceJp`).
   A cloned voice is a UUID inside one project; the same UUID does not exist in the
   others. Sharing one field would either break the session (Soniox rejects the UUID and
   TTS degrades to subtitles) or force a reset that silently discards the user's choice
   when they switch back.
5. **The managed client trusts the region in the session-key RESPONSE, not its own
   setting.** If the backend cannot serve the requested region it must say so; but for
   any response the client accepts, the region that arrives with the keys is the region
   those keys are for. Reading the setting instead would let a settings change between
   request and connect send US keys to an EU host.
6. **The backend never silently falls back to US.** A region whose project key is not
   configured is refused with a distinct error. Falling back would tell a user their audio
   stays in the EU while sending it to the US — a compliance failure, not a degraded
   experience.
7. **One managed voice slot per account, tagged with its region** — `account_id` stays the
   primary key of `soniox_voice_slots`. Switching region deletes the voice in the old
   region and rebuilds it in the new one (the reference clip lives in the browser, so
   rebuilding is an ability the system already has). A composite `(account_id, region)`
   key would triple consumption of a voice quota that, per the "per project within your
   organization" wording, is very likely org-wide and therefore shared across regions.
   See *Open questions*.
8. **Region is user-selectable for managed too**, using the same control as BYOK — not
   inferred from the account or from geography.

## Architecture

### Client

**`src/lib/soniox/regions.ts`** (new) — the single truth table.

```ts
export type SonioxRegion = 'us' | 'eu' | 'jp';
export const SONIOX_REGIONS: readonly SonioxRegion[];
export function sonioxHosts(region: SonioxRegion): { api: string; sttRt: string; ttsRt: string };
export function isSonioxRegion(value: unknown): value is SonioxRegion;
export const DEFAULT_SONIOX_REGION: SonioxRegion = 'us';
```

`isSonioxRegion` exists because the region arrives from two untrusted places: a persisted
settings value written by an older or newer build, and the backend's session-key response.
Both are normalized through it, falling back to `us` rather than producing a malformed
hostname.

**Wire components** each gain a `region` input and derive their own URL from
`sonioxHosts`:

- `SonioxSttConfig.region` → `wss://<sttRt>/transcribe-websocket`
- `SonioxTtsOptions.region` → `wss://<ttsRt>/tts-websocket`
- `SonioxTtsRestOptions.region` → `https://<ttsRt>/tts`
- `new SonioxVoicesClient(apiKey, region)` → `https://<api>/v1/voices`
- `SonioxClient.validateApiKeyAndFetchModels(apiKey, region)` → `https://<api>/v1/auth/temporary-api-key`

**`SonioxCredentialBundle`** gains `region: SonioxRegion`; `byokCredentials(apiKey, region)`.
`SonioxClient` reads `this.credentials.region` and passes it to both streams. The client
never learns where the region came from, which is what lets BYOK and managed share it.

**Settings** — `SonioxSettings` gains `region`, `apiKeyEu`, `apiKeyJp`, `voiceEu`,
`voiceJp`. Two helpers in `SonioxProviderConfig` are the only readers/writers of the
suffixed fields:

```ts
export function sonioxKeyField(region: SonioxRegion): 'apiKey' | 'apiKeyEu' | 'apiKeyJp';
export function sonioxVoiceField(region: SonioxRegion): 'voice' | 'voiceEu' | 'voiceJp';
```

`SonioxProviderConfig` overrides `extractCredentials` (pick the region's key; set
`endpoint` to the region) and `peekPrimaryCredential` (same pick), so
`ProviderSection`'s generic key input displays and validates the active region's key with
no provider-specific branching at the call site. `buildSessionConfig` reads the region's
voice field. `validateAndFetchModels` reads the region back off `creds.endpoint`.

Putting the region in `endpoint` is what makes switching region re-validate: the store's
cache key already includes `endpoint`, so `us`/`eu`/`jp` are three separate cache entries
without a new mechanism. It also means two regions that happen to hold the same key
string do not share a verdict.

**UI** — a region `<select>` at the top of `renderSonioxSettings`, above
`SonioxVoiceSection`, disabled while a session is active. It writes through
`updateActiveSonioxSettings`, so BYOK and the managed twin share one control the same way
they already share the voice and vocabulary controls. `sonioxVoiceSource` passes the
region into `SonioxVoicesClient` and adds it to the `useMemo` dependency list.

New locale keys (`settings.sonioxRegion`, its tooltip, and the three region names) must be
added to all 30 catalogs — `locales.consistency.test.ts` fails otherwise.

### Managed contract

`ManagedSessionRequest` gains `region: SonioxRegion`; the session-key response gains
`region`. `ManagedSonioxSession.fileBundles` stamps the **response's** region onto every
bundle it files. `KizunaAISonioxProviderConfig.acquireSessionResources` reads the region
from its slice to build the request; `prepareManagedVoice` and `ManagedVoicesClient` carry
it so a voice is claimed in the region the session will run in.

### Backend

Detailed in the companion spec. In summary: `createSonioxApi(apiKey, region)` with a
matching host table; `SONIOX_API_KEY_EU` / `SONIOX_API_KEY_JP` secrets alongside the
existing US `SONIOX_API_KEY`; a `region` column on `session_leases` (**without it the
reconciler polls the wrong region's usage logs, the lease never releases, and the account
409s every subsequent Start until the TTL expires**) and on `soniox_voice_slots`; the
reconciler sweeping and the voice reaper reaping per region; account deletion cleaning up
a voice in the region its slot records.

## Error handling

| Condition | Behaviour |
|---|---|
| Key belongs to a different region | Soniox answers 401. Caught at validation time, because changing region re-validates. Mid-session it falls through the existing `surfaceSttError` raw path, where the server's own words are the actionable part. |
| Region has no key entered yet | `extractCredentials` returns `{ ok: false }` — the same silent, non-erroring state as an empty key today. |
| Backend has no project key for the region | Session-key returns a distinct error code, mapped to one localized sentence. No fallback. |
| Persisted region is not a known value | `isSonioxRegion` rejects it; falls back to `us`. |
| Cloned voice UUID missing in the region | Per-region voice fields make this unreachable for a user who set it up in that region. A managed slot in the wrong region is rebuilt by `prepareManagedVoice`, which already handles an evicted slot. |

## Testing

Test-first, per the repo's working agreement.

- `src/lib/soniox/regions.test.ts` — the three host triples pinned exactly, plus a
  negative assertion that `eu.api.soniox.com` is not what we produce.
- The five wire components' existing URL assertions become parameterized over all three
  regions.
- `SonioxProviderConfig.test.ts` — `extractCredentials` picks the region's key; `endpoint`
  carries the region; `peekPrimaryCredential` matches; `buildSessionConfig` picks the
  region's voice.
- `settingsStore.test.ts` — an existing persisted `settings.soniox.apiKey` still loads
  into `apiKey` and is still the key used when region is `us`.
- `descriptorRegistry.test.ts` — the managed twin still answers identically to BYOK.
- `ManagedSonioxSession` — bundles carry the region from the **response**, not the
  request; a response region that is missing (an older backend) or unrecognized normalizes
  to `us`.
- `extension/manifest.consistency.test.ts` — the CSP lists all eight new origins.

## Extension CSP

`connect-src` gains eight origins: `https://api.eu.soniox.com`,
`https://api.jp.soniox.com`, `wss://stt-rt.eu.soniox.com`, `wss://stt-rt.jp.soniox.com`,
`wss://tts-rt.eu.soniox.com`, `wss://tts-rt.jp.soniox.com`,
`https://tts-rt.eu.soniox.com`, `https://tts-rt.jp.soniox.com`. The `tts-rt` hosts need
both schemes because the one-shot preview is HTTPS and the session stream is WSS, and a
`wss://` entry does not cover `https://` — the same pair the US host already carries.

## Out of scope

- Automatic region selection by geography or by account. The user picks.
- Migrating an existing managed user's data or cloned voice into another region.
- Per-region concurrency accounting. The existing org-wide caps are kept, which stays
  correct under the shared-quota assumption and is merely conservative if quotas turn out
  to be per project.

## Open questions

Neither blocks implementation; both were resolved conservatively, and either answer leaves
the shipped design correct.

1. **Is the ~20 cloned-voice quota org-wide or per project?** The docs place data
   residency "per project within your Soniox organization" but do not say whether quotas
   follow the project or the organization. Assumed org-wide, which is why decision 7 keeps
   one voice slot per account. If it is per project, `(account_id, region)` becomes
   available later as a pure relaxation.
2. **Are the STT/TTS concurrency caps org-wide or per project?** Assumed org-wide; the
   existing global caps are kept unchanged. If per project, the caps are three times more
   generous than we currently model and can be raised.

Both are answerable by Soniox support or by provisioning a second regional project and
observing the console.
