# Conversation Export — Design

**Date**: 2026-04-23
**Status**: Approved for implementation planning
**Scope**: New `ExportButton` in `MainPanel` conversation toolbar; new `src/utils/conversationExport.ts` utility module
**Related issue**: [#146](https://github.com/kizuna-ai-lab/sokuji/issues/146)

## Motivation

The conversation toolbar (`MainPanel.tsx:2704`) currently has six buttons: two
display-mode toggles, two font-size controls, a compact-view toggle, and a
clear-conversation button. There is no way for users to **save or share** the
translation transcript that scrolls past during a session.

Once a user clears the conversation or reloads the app, every translated line is
gone — conversation items live only in the React `items` and `systemAudioItems`
state in `MainPanel.tsx:104,519`, with no persistence layer. Users have asked for
the ability to grab a transcript at the end of a meeting, paste it into a chat
or document, or save it to disk for later reference.

This spec adds an Export action to the toolbar with three output paths
(clipboard / `.txt` / `.json`), without introducing persistence, history, or any
mid-session backup behaviour. The session is still ephemeral; the user just has
a way to capture it before it's gone.

## Non-Goals

- Persistence of conversations across sessions (no IndexedDB / localStorage).
- Automatic / background export. User must explicitly click.
- Subtitle formats (`.srt`, `.vtt`). The `audioSegments` data needed for
  accurate timing only exists for TTS output, not for user input transcripts;
  half-data subtitles would be misleading. Source for subtitles should be
  recorded audio + ASR timestamps, not the displayed chat log. (Originally
  proposed in issue #146; explicitly cut here.)
- Export filtering UI (date range, speaker selection, in-progress inclusion).
  The filter rules are fixed.
- Native "Save As…" dialog in Electron. Default download behaviour is acceptable
  and matches Extension behaviour.
- Sharing via OS share API.
- Re-importing an exported file back into Sokuji.

## User-Visible Behavior

### Toolbar Position

The new Export button is the **6th button**, inserted between the Compact toggle
and the Clear (trash) button:

```
[DisplayMode-speaker] [DisplayMode-participant?] [Font-] [Font+] [Compact] [Export] [Clear]
```

Rationale for order:

- Clear stays rightmost — preserves existing muscle memory; rightmost position
  isolates the destructive button.
- Export sits adjacent to Clear because both act on the conversation as a whole
  (a different semantic group from the view-configuration buttons).
- View-configuration buttons stay clustered (display + font + compact), as a
  visually coherent run.

A small extra left-margin on Export (~4–6px) **may** be added to gently
separate the view-config group from the action group. This is a visual polish
decision left to the implementer; not load-bearing.

### Export Button

| Aspect | Value |
|---|---|
| Trigger icon | Lucide `Download` + small `ChevronDown` |
| Tooltip / `aria-label` | `Export conversation` (i18n: `mainPanel.toolbar.export`) |
| `aria-haspopup` | `menu` |
| `aria-expanded` | reflects open state |
| Disabled when | Zero `completed` messages remain after filtering (see Data Pipeline) |
| Style class | Reuses existing toolbar button look; new component owns own SCSS |

When the toolbar itself is hidden (i.e. `combinedItems.length === 0`), the
Export button is naturally not rendered. The disabled state above only applies
to the rare case where some items exist but none have `status === 'completed'`.

### Dropdown Menu

Click on the trigger toggles a dropdown menu anchored below the button,
right-aligned to the button's right edge.

```
┌────────────────────────────┐
│ [Copy icon]  Copy to clipboard │
│ [FileText]   Download as .txt  │
│ [FileJson]   Download as .json │
└────────────────────────────┘
```

| Item | Icon | Action |
|---|---|---|
| Copy to clipboard | Lucide `Copy` | Run clipboard copy with the `.txt` body **without** header |
| Download as .txt | Lucide `FileText` | Trigger download of full `.txt` file |
| Download as .json | Lucide `FileJson` | Trigger download of `.json` file |

**Interaction:**

- Click trigger again → toggle closed.
- Click outside dropdown → close.
- `Esc` → close and return focus to trigger.
- `↑` / `↓` → move focus between menu items.
- `Enter` / `Space` on a focused item → execute and close.
- Click any menu item → execute and close.

**Accessibility:** menu has `role="menu"`; each item has `role="menuitem"`.

**Positioning library:** `@floating-ui/react` (already a dependency, also drives
the existing `Tooltip` component in this codebase). If the library turns out to
have ergonomic problems for menus we can revisit, but the default expectation is
no new dependency.

### Toast Feedback

| Trigger | Toast? | Why |
|---|---|---|
| Copy succeeds | Yes — "Conversation copied to clipboard" (auto-dismiss ~2s) | No native UI for clipboard writes |
| Copy fails | Yes — "Failed to copy. Check browser permissions." (red, ~4s) | Same |
| Download (.txt or .json) succeeds | No | Browser / Electron native download UI is the feedback |
| Download fails | No (programmatic failure of `<a download>` is exceedingly rare) | — |

**Toast component:** Implementation must first `grep` for any existing toast /
notification component in the codebase (e.g. under `src/components/`). If none
exists, add a minimal one at `src/components/Toast/` — a portal-mounted `<div>`
with `setTimeout`-based dismissal. Keep API surface tiny (`showToast(text, variant?)`).
This component is not the focus of this spec; if the implementer prefers an
existing micro-library that is already a transitive dependency, that's
acceptable.

## Data Pipeline

```
items (speaker)                ┐
                               ├─→ concat ─→ filter ─→ sort by createdAt ASC ─→ NormalizedMessage[]
systemAudioItems (participant) ┘
```

**Source arrays** (both `ConversationItem[]`, defined in `src/services/interfaces/IClient.ts:9`):

- `items` — `MainPanel.tsx:104` — speaker (mic input + translation output)
- `systemAudioItems` — `MainPanel.tsx:519` — participant (system audio capture
  + its translation). Only populated when system audio is being captured; may
  be empty.

**Filter rules** (applied to the concatenated array):

- Keep only items where `status === 'completed'`.
- Drop items where `type !== 'message'` (excludes `function_call`,
  `function_call_output`, `error`).
- Drop items where `role === 'system'` (excludes session lifecycle events).
- Drop items where the chosen text (`formatted.transcript || formatted.text`) is empty.

**Sort:** ascending by `createdAt`. JavaScript's `Array.prototype.sort` is
stable; ties (same millisecond) preserve concatenation order, which matches
display order.

**Normalized shape** (in-memory only, not part of the JSON output schema):

```ts
type NormalizedMessage = {
  id: string;
  createdAt: number;             // ms since epoch
  source: 'speaker' | 'participant';
  kind: 'original' | 'translation';   // 'user' role → 'original'; 'assistant' role → 'translation'
  text: string;                  // from formatted.transcript || formatted.text (whichever is populated)
};
```

**One displayable text per item, not per pair:** Each `ConversationItem`
populates exactly one of `formatted.transcript` or `formatted.text`. Originals
and translations arrive as separate items (`role: 'user'` and `role: 'assistant'`
respectively). They are NOT paired into a single output row — each item becomes
its own `NormalizedMessage`, distinguished by `kind`. Attempting to pair by
adjacency would be unreliable (throttling, ordering quirks, missing
counterparts) and could mislead the reader.

**Audio data is dropped:** `formatted.audio` (Int16Array) and
`formatted.audioSegments` (TTS internal timing) are never included in any
output format. They're either non-serializable, internal implementation detail,
or both.

## Session Metadata

Captured **at export time** as a snapshot from `settingsStore`. Mid-session
changes to provider/model/language settings are not tracked per-message, so the
metadata reflects current settings only. This caveat is recorded in both `.txt`
header and `.json` `note` field.

```ts
type SessionMetadata = {
  exportedAt: string;            // ISO 8601, UTC
  appVersion: string | null;     // from build-injected constant; null if unavailable
  provider: string;              // e.g. 'openai', 'gemini', 'local-inference'
  models: Record<string, string>;// keys vary by provider; see table below
  sourceLanguage: string;        // e.g. 'zh'
  targetLanguage: string;        // e.g. 'en'
};
```

**Models per provider:**

| Provider | Keys in `models` |
|---|---|
| `openai` | `translation`, `transcription` |
| `gemini` | `translation` |
| `kizuna-ai` | `translation` |
| `openai-compatible` | `translation` |
| `palabra` | `translation` (value is provider-fixed e.g. `ast-v2-s2s`) |
| `volcengine` | `translation` (value is provider-fixed) |
| `local-inference` | `asr`, `translation`, `tts` |

A small helper `getActiveModelInfo(state, provider)` lives in
`conversationExport.ts` and dispatches per provider, reading from
`state.openai.model`, `state.openai.transcriptModel`, etc. (See
`settingsStore.ts:51,78,224,254,447` for the existing field names.) Empty /
unselected model fields are **omitted** from the `models` object — never
serialized as empty string or `null` (cleaner schema, easier consumer parsing).

## Format Specifications

### `.txt`

```
Sokuji conversation export
Generated: 2026-04-23 14:30:00
Provider: openai
Models: translation=gpt-realtime-mini, transcription=gpt-4o-mini-transcribe
Source: zh → Target: en
Note: settings reflect current state at export, not mid-session changes.

[14:32:05] You:           今天天气不错
[14:32:06] You (trans):   The weather is nice today
[14:32:10] Other:         Yes, perfect for a walk
[14:32:11] Other (trans): 是的，适合散步
```

**Header rules:**

- Up to six lines, in fixed order: title, generated timestamp, provider,
  models, language pair, note. The `Models:` line is omitted entirely when the
  `models` object is empty (i.e. no model info available for this provider) —
  so the header is either 5 or 6 lines depending on provider. Followed by one
  blank line, then messages.
- `Generated:` time is local time, formatted `YYYY-MM-DD HH:MM:SS`. Local time
  matches the per-message `[HH:MM:SS]` prefix, avoids confusion.
- `Models:` is a single line, comma-separated `key=value` pairs.
- `Source:` and `Target:` use the language codes as stored in settings (no
  human-readable name lookup; raw codes keep the file machine-friendly).

**Message line rules:**

- Format: `[HH:MM:SS] <Label>:<padding><text>` — one item per line.
- `<Label>` is one of four values, depending on `source` × `kind`:
  - `source=speaker, kind=original` → `You`
  - `source=speaker, kind=translation` → `You (trans)`
  - `source=participant, kind=original` → `Other`
  - `source=participant, kind=translation` → `Other (trans)`
- The label words `You`, `Other`, and the suffix `(trans)` are all i18n'd
  (keys `mainPanel.export.speakerYou`, `mainPanel.export.speakerOther`,
  `mainPanel.export.translationSuffix`).
- Pad `<Label>:` to a column width that fits the longest of the four
  localized labels + 1 trailing space. Implementation computes `colWidth =
  max(8, longestLabelLength + 1)` per export, so alignment doesn't break in
  any locale.
- One message per line; no blank lines between messages.

**File extension:** `.txt`. **MIME:** `text/plain;charset=utf-8`.

### `.json`

```json
{
  "exportedAt": "2026-04-23T14:30:00.000Z",
  "appVersion": "0.21.1",
  "session": {
    "provider": "openai",
    "models": {
      "translation": "gpt-realtime-mini",
      "transcription": "gpt-4o-mini-transcribe"
    },
    "sourceLanguage": "zh",
    "targetLanguage": "en",
    "note": "settings reflect current state at export, not mid-session changes"
  },
  "messageCount": 42,
  "messages": [
    {
      "id": "item_user_abc",
      "timestamp": "2026-04-23T14:32:05.123Z",
      "source": "you",
      "kind": "original",
      "text": "今天天气不错"
    },
    {
      "id": "item_asst_def",
      "timestamp": "2026-04-23T14:32:06.234Z",
      "source": "you",
      "kind": "translation",
      "text": "The weather is nice today"
    }
  ]
}
```

**Schema rules:**

- `exportedAt` and per-message `timestamp` are ISO 8601 UTC strings.
- `appVersion` is read from a build-time injected constant (Vite `define` or
  similar); `null` if unavailable.
- `models` keys vary per provider as described above; empty values omitted.
- `messageCount` is `messages.length`, included for convenience of consumers
  that want to validate without iterating.
- `source` is `"you"` or `"other"` — who originated the spoken content. Lowercase, machine-readable, **not** i18n'd.
- `kind` is `"original"` (transcribed user/participant input) or `"translation"` (AI's translation output).
- `text` is the displayable string content. Always non-empty (the filter rule above ensures this).

**File extension:** `.json`. **MIME:** `application/json`.

**JSON formatting:** indent 2 spaces. Output ends with a trailing newline.

### Clipboard payload

Same body as `.txt` but **without** the header (5 or 6 lines) and the
blank line that follows it. The clipboard is for pasting into chats/documents,
where the header is noise.

```
[14:32:05] You:           今天天气不错
[14:32:06] You (trans):   The weather is nice today
[14:32:10] Other:         Yes, perfect for a walk
[14:32:11] Other (trans): 是的，适合散步
```

## File Naming

- `sokuji-conversation-YYYYMMDD-HHMMSS.txt`
- `sokuji-conversation-YYYYMMDD-HHMMSS.json`

Local time, matching the header's `Generated:` timestamp. No timezone suffix
in the filename (keeps it short; the file content carries timezone info via the
ISO 8601 `exportedAt`).

If the user triggers two exports in the same second, the filenames collide and
the browser/Electron will append `(1)`, `(2)`, etc. We don't try to prevent
this.

## Download Mechanism

Both shipped platforms (Extension side panel, Electron) use the same code path:

```ts
async function downloadFile(content: string, filename: string, mime: string): Promise<void> {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

**Why no `chrome.downloads` API and no `downloads` permission:**

- Side panel is a regular HTML page in `chrome-extension://...` origin with
  full DOM access. `<a download>` is HTML standard, not a Chrome extension
  API, and works in this context without any extension-specific permission.
- `chrome.downloads` is needed when calling from a service worker (no DOM) or
  a content script (page CSP), neither of which applies here.
- The browser's download bar (a browser-chrome-level UI) appears for downloads
  triggered from the side panel, providing native feedback without any toast.

**Why no Electron native Save As dialog:**

- A transcript export does not justify building a `dialog.showSaveDialog` IPC
  channel (would require preload + main + renderer changes).
- Saving to default Downloads folder is consistent with Extension behaviour.
- If users later request Save As, a future patch can add it.

**Implementation note:** if real-world testing on a future Chrome version
reveals that side-panel `<a download>` breaks, the fallback is to add
`"downloads"` to `extension/manifest.json` permissions and branch
`downloadFile` on `isExtension()` to use `chrome.downloads.download(...)`. Not
doing this preemptively to avoid the permission surface.

## Clipboard Mechanism

```ts
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through */ }
  }
  // Legacy fallback
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
```

The fallback handles older Electron versions and any rare context where the
async clipboard API is unavailable. Caller (`ExportButton`) shows the
appropriate toast based on the boolean return.

## Code Organization

```
src/
├── utils/
│   └── conversationExport.ts            ← NEW
└── components/
    ├── MainPanel/
    │   ├── ExportButton.tsx             ← NEW
    │   ├── ExportButton.scss            ← NEW
    │   ├── MainPanel.tsx                ← MODIFIED: insert <ExportButton/> in toolbar
    │   └── MainPanel.scss               ← MAYBE: minor toolbar grouping margin
    └── Toast/                           ← NEW (only if no existing toast component found)
        ├── Toast.tsx
        └── Toast.scss
```

**`src/utils/conversationExport.ts`** exports six pure functions:

```ts
// Data layer
export function normalizeMessages(
  items: ConversationItem[],
  systemAudioItems: ConversationItem[],
): NormalizedMessage[];

export function getActiveModelInfo(
  state: SettingsState,
  provider: Provider,
): Record<string, string>;

export function buildSessionMetadata(state: SettingsState): SessionMetadata;

// Format layer
export function formatAsTxt(
  messages: NormalizedMessage[],
  metadata: SessionMetadata,
  opts: { includeHeader: boolean },
  i18n: TxtI18n,
): string;

export function formatAsJson(
  messages: NormalizedMessage[],
  metadata: SessionMetadata,
): string;

// Side-effect layer (thin wrappers)
export function copyToClipboard(text: string): Promise<boolean>;
export function downloadFile(content: string, filename: string, mime: string): void;
```

`ExportButton.tsx` only orchestrates: it reads props (`items`,
`systemAudioItems`), reads settings via store hook, calls the utils, calls the
toast. The component contains no formatting logic. This separation keeps the
formatting logic trivially testable by hand without React.

## i18n Keys

New keys (English values shown; only English added in this PR — other 35+
languages fall back via i18next's existing missing-key behaviour and can be
backfilled in a later translation PR):

```
mainPanel.toolbar.export = "Export conversation"
mainPanel.export.copyToClipboard = "Copy to clipboard"
mainPanel.export.downloadTxt = "Download as .txt"
mainPanel.export.downloadJson = "Download as .json"
mainPanel.export.copySuccess = "Conversation copied to clipboard"
mainPanel.export.copyFailed = "Failed to copy. Check browser permissions."
mainPanel.export.speakerYou = "You"
mainPanel.export.speakerOther = "Other"
mainPanel.export.headerTitle = "Sokuji conversation export"
mainPanel.export.headerGenerated = "Generated"
mainPanel.export.headerProvider = "Provider"
mainPanel.export.headerModels = "Models"
mainPanel.export.headerSource = "Source"
mainPanel.export.headerTarget = "Target"
mainPanel.export.headerNote = "settings reflect current state at export, not mid-session changes"
mainPanel.export.translationSuffix = "(trans)"
```

The `.json` output uses **literal English** for `note`, `speaker`, etc.,
regardless of UI locale — JSON is a machine format, locale-stable schema is
more important than UI consistency.

## Edge Cases

| Case | Behaviour |
|---|---|
| All messages still `in_progress` | Export button disabled |
| Only `speaker` items, no system audio | `systemAudioItems` is empty array; concat is a no-op; works |
| Only `participant` items | Symmetric; works |
| Two messages with identical `createdAt` ms | Stable sort preserves concat order (speaker first, then participant) |
| Item has only `formatted.transcript` (typical for user input / local inference) | Used as `text`; `kind` derived from `role` |
| Item has only `formatted.text` (typical for cloud assistant output) | Used as `text`; `kind` derived from `role` |
| Item has both (rare but possible) | `transcript` wins via `transcript || text` precedence |
| Item has neither | Filtered out; never reaches output |
| Local-inference user has not selected a TTS model | `models.tts` omitted; `models.asr` and `models.translation` still present |
| `appVersion` constant not injected by build | `.json` has `appVersion: null`; `.txt` header omits an "App version" line (we don't include one anyway) |
| User clicks Clear during a download | Download already has a content snapshot (passed by value); not affected |
| User triggers two downloads in the same second | Browser/Electron auto-suffixes `(1)`, `(2)` |
| Clipboard API unavailable | Falls back to `document.execCommand('copy')`; if both fail, error toast |
| Settings change between opening dropdown and clicking item | Metadata captured at click time, so reflects the latest settings; acceptable |

## Implementation Order Suggestion

1. `conversationExport.ts` utility (no React dependency; can be developed and
   manually exercised in isolation).
2. Toast component (only if needed after `grep` confirms no existing one).
3. `ExportButton.tsx` + SCSS.
4. Wire `<ExportButton/>` into `MainPanel.tsx` toolbar at the documented
   position; add i18n keys.
5. Manual smoke test in Electron and Extension side panel: Copy, .txt,
   .json — for both speaker-only and mixed-source conversations.

## Out of Scope (Recap)

The following were considered and explicitly cut:

- `.srt` / `.vtt` subtitle formats (data isn't suitable; better sourced from
  raw audio + ASR timestamps in a future feature).
- Native Save As dialog in Electron.
- Persistent conversation history (separate feature, not blocking this one).
- Mid-session metadata snapshots per message (significant refactor, low ROI
  for export use case).
- Email / share / cloud upload destinations.
- Re-import.
