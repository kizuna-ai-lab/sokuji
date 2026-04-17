# Conversation Display — Visual Language & Filter Controls

Status: Draft · 2026-04-17 · Related: [Issue #147](https://github.com/kizuna-ai-lab/sokuji/issues/147)

## Problem

The conversation panel renders four conceptually distinct utterance types — speaker source, speaker translation, participant source, participant translation — using a visual grammar that mixes alignment (role) with color (audio source). Users cannot quickly tell who spoke or which layer they are reading without learning the mapping. Issue #147 additionally asks for a toggle to hide source or translation to reduce clutter, but the underlying visual language must be addressed first: layering a filter on top of an unclear grammar does not fix readability.

## Goals

1. Replace the current alignment+color grammar with a single, Slack-style layout in which a glance answers "who spoke" and "which layer is this".
2. Add per-scope display filters (Me / Participants), each with three states (Source / Translation / Both), integrated into the existing conversation toolbar without breaking its minimal icon-only aesthetic.
3. Remain provider-agnostic: no change to `sessionStore` contents and no assumption that a source `ConversationItem` can be paired with its translation counterpart (not possible with OpenAI Realtime, Gemini Live, or Palabra AI).
4. Persist filter state across sessions.

## Non-goals

- Redesigning the `advanced` uiMode side-panels (waveform, tool calls). They keep consuming the flat item array.
- Multi-participant differentiation (P1/P2/P3 distinct colors).
- Conversation export filtering — Issue #146 territory.
- A store-level "turn" abstraction that groups source and translation items into a single record.

## Visual language

A single flush-left message-row layout, Approach C from brainstorming.

- **Header** (shown only on the first row of a same-`source` run):
  - 26×26 circular avatar. Me = `#10a37f` (existing brand green). Participants = `#f39c12` (existing participant accent).
  - Name row: localized scope name + timestamp (e.g., `Me · 09:12`).
- **Content line** (every row):
  - Language badge (source-language ISO code for `role='user'`; target-language ISO code for `role='assistant'`).
  - Text body.
  - Source rows (`role='user'`): muted grey italic text, neutral badge.
  - Translation rows (`role='assistant'`): primary text, brand-green-tinted badge.
- **Slack-style grouping**: consecutive rows with the same `source` hide the header; when `source` changes, a new header appears. No data-level pairing required — rendering follows the provider's event order.
- **Playing state**: the existing `currentPlayingItemId` still drives a glow on the row that is currently playing audio. Karaoke highlighting on `formatted.audioSegments` is preserved unchanged.
- Errors (`type='error'`) continue to render as a standalone system-style row and are exempt from filtering.

### Language-code derivation for badges

Given `(item.source, item.role)` and the current `sourceLanguage` / `targetLanguage` from the active provider's settings:

| `source` | `role` | Badge shows |
|----------|--------|-------------|
| `speaker`     | `user`      | `sourceLanguage` |
| `speaker`     | `assistant` | `targetLanguage` |
| `participant` | `user`      | `targetLanguage` |
| `participant` | `assistant` | `sourceLanguage` |

Rationale: `role='user'` is the original speech in the speaker's native language; `role='assistant'` is its translation into the counterpart language.

## Filter controls

Up to two click-to-cycle buttons prepended to `.conversation-toolbar`, matching the existing 14px icon-only button style (`#555` default, transparent background, subtle hover).

- Layout (right-aligned toolbar, in order): `[Me Both] [Them Both] | [A-] [A+] | [Trash]`.
- Each button shows a scope icon (Lucide candidates: `Mic` for Me, `Users` for Participants — icon selection deferred) and the current state label (`Both` / `Src` / `Trans`, localized).
- Click cycles `both → source → translation → both`.
- Tooltip uses the existing `src/components/Tooltip/Tooltip.tsx` component (`@floating-ui/react`, hover + focus triggers, dark theme) with `icon="none"` wrapping the button. The icon+short-label button can't carry enough meaning by itself, so a tooltip like `"Me: Both — click to change"` is required, not optional. Content is localized via `mainPanel.displayMode.tooltip`.

### Conditional rendering of the participant button

The participant button is rendered only when actual participant content exists in the current conversation — i.e. when `systemAudioItems.length > 0` inside `MainPanel`. Rationale: the filter is meaningless when no participant item will ever be displayed, and gating on content (rather than on whether a device is configured) keeps the toolbar in sync with what the user actually sees. The speaker button is always rendered when the toolbar itself is rendered.

Side effect worth testing in QA: after the user de-selects the system audio device, any historical participant items already captured remain in `systemAudioItems` (they are not cleared on device change), so the participant button stays visible and the persisted `participantDisplayMode` keeps applying to those rows. The button only disappears once the conversation is cleared.

Users cycle a scope independently; there is no global "reset" button in v1. Combined filters such as "Me: Source, Them: Translation" are legal and useful for hybrid reading modes.

## State and persistence

Two fields added to `CommonSettings` in `src/stores/settingsStore.ts`:

```ts
type DisplayMode = 'source' | 'translation' | 'both';

speakerDisplayMode: DisplayMode;      // default 'both'
participantDisplayMode: DisplayMode;  // default 'both'
```

Two async setters following the existing `setConversationFontSize` pattern:

```ts
setSpeakerDisplayMode: async (mode: DisplayMode) => {
  const previous = get().speakerDisplayMode;
  set({ speakerDisplayMode: mode });
  try {
    await ServiceFactory.getSettingsService()
      .setSetting('settings.common.speakerDisplayMode', mode);
  } catch (error) {
    console.error('[SettingsStore] Error persisting speakerDisplayMode:', error);
    set({ speakerDisplayMode: previous });
  }
}
```

And the symmetric setter for `participantDisplayMode`. Two new selector hooks (`useSpeakerDisplayMode`, `useParticipantDisplayMode`) via `subscribeWithSelector`. Defaults are loaded by the existing `SettingsInitializer` alongside `conversationFontSize`.

No cycle action is added to the store. The button computes the next value (`both → source → translation → both`) and calls the setter. Keeping the store minimal.

## Filter logic

New file `src/components/MainPanel/conversationFilter.ts`:

```ts
import type { ConversationItem } from '../../services/interfaces/IClient';

export type DisplayMode = 'source' | 'translation' | 'both';

export function shouldShowItem(
  item: ConversationItem,
  speakerMode: DisplayMode,
  participantMode: DisplayMode,
): boolean {
  if (item.type === 'error' || item.role === 'system') return true;
  // Non-message rows (function_call, function_call_output, etc.) aren't
  // source-vs-translation pairs, so they bypass the per-scope filter.
  if (item.type !== 'message') return true;
  const source = item.source ?? 'speaker';
  const mode = source === 'speaker' ? speakerMode : participantMode;
  if (mode === 'both') return true;
  if (mode === 'source')      return item.role === 'user';
  if (mode === 'translation') return item.role === 'assistant';
  return true;
}
```

Applied inside the existing `filteredItems` computation in `MainPanel.tsx`, after the `uiMode` filter. Pure, trivially unit-testable.

## Component changes

### New files

- `src/components/MainPanel/DisplayModeButton.tsx` — scope + state button, click cycles. Renders its `<button>` wrapped in the existing `Tooltip` component (`icon="none"`, hover+focus) with content from `mainPanel.displayMode.tooltip`.
- `src/components/MainPanel/ConversationRow.tsx` — Approach C row (header + content line). Replaces the per-item bubble rendering in `renderConversationItem`.
- `src/components/MainPanel/conversationFilter.ts` — pure predicate above.
- `src/components/MainPanel/conversationFilter.test.ts` — unit tests covering the 9 mode×role combinations plus error/system bypass.

### Modified files

- `src/components/MainPanel/MainPanel.tsx`:
  - Pull `speakerDisplayMode`, `participantDisplayMode` via the new hooks.
  - Render the speaker `DisplayModeButton` inside `.conversation-toolbar` before the font-size buttons. Render the participant `DisplayModeButton` next to it only when `systemAudioItems.length > 0` (content-based gate — the button appears when there's actual participant content to filter).
  - In `filteredItems`: apply `shouldShowItem` after the `uiMode` filter.
  - Replace `renderConversationItem` output with `<ConversationRow item={item} prevItem={…} sourceLanguage={…} targetLanguage={…} />`. `prevItem` must walk backward to the last previously-rendered-as-row item so grouping isn't broken by interleaved tool-call / audio-only rows in advanced mode. Keep the error-row branch using the existing minimal style.
- `src/components/MainPanel/MainPanel.scss`:
  - **No edits required** in this file. The new row/button styles live in their own co-located partials (`ConversationRow.scss`, `DisplayModeButton.scss`) imported by those components.
  - The existing `.message-bubble` rules (`&.user`, `&.assistant`, `&.system`, `&.participant-source`, `.error`) are intentionally **kept**: although the text-message branch no longer renders them, the error branch and the advanced-mode branches (audio-only indicator, tool calls, tool outputs) still use the same classes via `renderConversationItem`. Deleting them would break advanced-mode alignment and tool-call styling.
  - A later pass can unify advanced-mode rendering onto the new grammar; that is out of scope here.
- `src/stores/settingsStore.ts`:
  - Add the two fields to `CommonSettings` and their setters.
  - Add loader wiring in the initializer block that currently populates `conversationFontSize` and `textOnly`.
- `src/locales/en/translation.json`:
  - Add the new keys below. Other locales fall back to English per existing convention and can be filled later.

### i18n keys

```
mainPanel.displayMode.speaker        "Me"
mainPanel.displayMode.participant    "Them"
mainPanel.displayMode.both           "Both"
mainPanel.displayMode.source         "Src"
mainPanel.displayMode.translation    "Trans"
mainPanel.displayMode.tooltip        "{{scope}}: {{mode}} — click to change"
```

## Edge cases

- **Late-arriving half of a utterance**: streaming a source transcription before its translation (or vice versa) renders as it arrives. No orphan handling needed — each item is self-contained.
- **Cross-talk**: if `speaker` and `participant` items interleave, the Slack-style header reappears whenever `source` changes. Each block is independently correct.
- **Filter hides everything in a session**: the `.empty-state` block is not shown (items exist, just filtered). An active filter is implied by the button label. Acceptable v1 behavior; revisit if users complain.
- **`advanced` uiMode extras** (audio-only indicators, tool calls, tool outputs): still rendered from the unfiltered `items` array before the display-mode filter is applied. Only the message-bubble branch is filtered.
- **Errors and system messages**: always shown regardless of filter.
- **Participant audio toggled off mid-session**: the participant button unmounts on the next render; any historical participant items already in `systemAudioItems` continue to render according to the persisted `participantDisplayMode` (which is still applied by the filter predicate). If the user toggles it back on, the button re-appears with its previous mode.

## Testing

- Unit: `conversationFilter.test.ts` — all 9 `(speakerMode, participantMode) × (source, role)` matrix combinations plus error/system bypass.
- Unit: setter test mirroring `setConversationFontSize` if a pattern already exists in the repo.
- Manual verification: render in basic and advanced uiMode, cycle each button, confirm persistence across page reload, exercise same-source grouping by speaking twice in a row, confirm playing-glow and karaoke highlighting still work on the new row layout.

## Open decisions (resolved after spec approval)

- Exact Lucide icons for scope (`Mic` / `Users` are candidates but final choice is deferred to implementation).
- Whether to add an optional "filter active" visual hint if the Both-default green label is not discoverable enough — not needed in v1.

## Out of scope for this spec

- Per-participant distinct coloring for P1/P2/P3 scenarios.
- Export-with-current-filter (Issue #146).
- Advanced-mode side-panel redesign.
