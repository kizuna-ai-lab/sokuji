# Tutorial Update: Subtitle Mode Feature Page — Design

**Date**: 2026-05-12
**Status**: Approved for implementation planning
**Repo affected**: `sokuji-backend` (sister repo at `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend`), not `sokuji-react`.

## Context

Sokuji v0.26.0 shipped one user-facing feature: **Floating Subtitle Mode** (PR #225, Electron-only). The main window transforms into a translucent always-on-top bar showing the live bilingual translation — similar to iFlytek Tingjian. v0.26.1 was an internal model-list filter fix with no user-facing impact.

The `sokuji-backend` documentation site currently has one feature page (`/docs/features/participant-audio`) plus per-platform / per-provider tutorials. It does not yet document subtitle mode. This spec adds a new feature page that explains the floating bar — what it does, how to enter and exit, the layout of each control, customization options, pin/lock behavior, and limitations.

The design follows the precedent set by `ParticipantAudio.tsx` for page structure, but enriches it with ~8 screenshots in the style of the existing screenshot-dense tutorial pages.

## Non-Goals

- Documenting the v0.26.1 OpenAI voice-agent model filter (internal, no user-visible behavior change).
- Documenting the v0.26.0 voice-passthrough tooltip-wording polish (`8096fab7`) — existing docs do not cover the toggle's disabled state, so there is nothing to clarify there.
- Adding a separate `/docs/tutorials/subtitle-mode` step-by-step page. The feature page is canonical.
- Updating the marketing landing page's features section to mention subtitle mode (deferred; not required for documentation completeness).
- Browser-extension overlay documentation. Subtitle mode is desktop-only in v0.26.0; extension support is on a later roadmap.
- Per-platform install-guide cross-links to subtitle mode (out of scope; readers reach the feature page via DocsHome or sidebar).

## User-Visible Behavior

The new page renders at `/docs/features/subtitle-mode`. Reaching it:

- **DocsHome card**: A new card in the "Resources" section, placed after the Participant Audio card.
- **DocsLayout sidebar**: A new top-level entry "Subtitle Mode" placed directly after the existing "Participant Audio" entry, using the `Captions` icon from `lucide-react`.
- **Direct URL**: `/docs/features/subtitle-mode`.

The page itself is laid out as a sequence of titled sections, each section being a short prose block plus (for most sections) either a screenshot or a small table, terminating in a Tips list and an FAQ. Screenshots are click-to-zoom via the existing `Lightbox` component (`components/docs/Lightbox.tsx`), matching the tutorial pages.

### Page sections (in render order)

1. **Title and subtitle** — `subtitleMode.title` / `subtitleMode.subtitle`.
2. **Hero image** — full-width `hero.png` showing the floating bar pinned over a video-call window.
3. **Overview** — what subtitle mode is, when to use it, prerequisites. Includes an info-box callout for extension users: "Subtitle Mode is available in the desktop app (v0.26.0+) only. Browser extension support is planned for a future release."
4. **How to enter and exit** — entry button screenshot, ESC and `✕` exit instructions, note that the entry button is disabled until a session is active.
5. **Floating bar layout** — annotated screenshot (`bar-annotated.png`) plus a 3-row legend table:
   - Left segment: Sokuji logo, quota slot (reserved for future use).
   - Center segment: Session timer (`HH:MM:SS`) and language pair (e.g., `ZH → EN`).
   - Right segment: Display-mode buttons (speaker / participant), font − / +, compact toggle, Export, Clear, Settings (⚙), Pin (📌), Lock (🔒), Exit (✕).
6. **Customization** — settings popover screenshot plus a 6-row table of customizable fields and their effect:
   - Font size (16–48 px)
   - Compact mode (toggle)
   - Background opacity (0–100%)
   - Background color (6-swatch palette)
   - Source text color (6-swatch palette)
   - Translation text color (6-swatch palette)
7. **Pin and Lock** — two side-by-side comparison screenshots (`pin-toggle.png`, `lock-toggle.png`) plus a behavior table:
   - Pin (📌): toggles always-on-top.
   - Lock (🔒): freezes both position and size — disables window-edge resize and the bar's drag region.
8. **Compact vs. expanded subtitle rows** — comparison screenshot (`compact-vs-expanded.png`) plus a one-paragraph note explaining that compact mode (default `on` in subtitle mode) hides the row header, language badge, and play button to maximize subtitle real estate.
9. **Session ended state** — screenshot (`session-ended.png`) plus a one-paragraph note: if the session ends (manual stop, network drop, provider error) while in subtitle mode, the stream is replaced by a "Session ended" placeholder with a "Return to main window" button; the bar (with ✕) remains.
10. **Tips and limitations** — bulleted list:
    - Window bounds (position, size) are persisted across launches.
    - Subtitle mode does not own session lifecycle — start and stop sessions from the main window.
    - You cannot change source / target language from inside subtitle mode.
    - On some older Linux desktop environments without compositor transparency, the background may appear opaque; functionality is unaffected.
    - Locking disables both moving and resizing; unlock to reposition.
11. **FAQ** — 5 Q/A items:
    1. *Why is the subtitle button disabled?* — Session must be active.
    2. *Does it work in the browser extension?* — Desktop only in v0.26.0; extension support planned.
    3. *Can I show only the translation (or only the source)?* — Yes, via the Display Mode buttons in the right cluster; same controls as the main window.
    4. *How do I exit?* — `ESC` while focused, or the `✕` button.
    5. *Are my color and size choices remembered?* — Yes, all subtitle settings persist across launches.

## Architecture and Window Lifecycle

Not applicable — this is documentation-only work. The page is a single React component (`SubtitleMode.tsx`) reading translations from the existing `useI18n()` hook. No new lifecycle, no new services.

## State

No new state. The page reads only locale strings. Image paths are static.

## Component Structure

### Created

```
web/src/pages/docs/SubtitleMode.tsx
```

Single functional component, layout pattern adapted from `ParticipantAudio.tsx`:

```tsx
export function SubtitleMode() {
  const { t } = useI18n();
  const [lightboxImage, setLightboxImage] = useState<{src: string; alt: string} | null>(null);
  const open = (src: string, alt: string) => setLightboxImage({ src, alt });
  // ...
  return (
    <div className="docs-content subtitle-mode-page">
      <h1>{t('subtitleMode.title')}</h1>
      <p>{t('subtitleMode.subtitle')}</p>
      <img className="subtitle-mode-page__hero"
           src="/features/subtitle-mode/hero.png"
           alt={t('subtitleMode.title')}
           onClick={() => open('/features/subtitle-mode/hero.png', t('subtitleMode.title'))} />
      {/* sections 3–11, each as <section className="subtitle-mode-page__section">…</section> */}
      {lightboxImage && <Lightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />}
    </div>
  );
}
```

Re-uses the `Lightbox` component from `components/docs/Lightbox.tsx`. Page-level SCSS class `subtitle-mode-page` keeps styles scoped; selectors mirror the existing `.participant-audio-page__*` pattern (info-box, dual-box, table-wrapper, table, note, subsection, faq-item) so most rules can be shared.

### Modified

- `web/src/App.tsx` — add inside the `/docs` route block:
  ```tsx
  <Route path="features/subtitle-mode" element={<SubtitleMode />} />
  ```
  Import `SubtitleMode` from `./pages/docs/SubtitleMode`.
- `web/src/components/layout/DocsLayout.tsx` — after the existing `participant-audio` nav entry, add:
  ```tsx
  { path: '/docs/features/subtitle-mode', icon: Captions, labelKey: 'nav.subtitleMode' },
  ```
  Import `Captions` from `lucide-react`.
- `web/src/pages/docs/DocsHome.tsx` — inside the Resources `<div className="docs-home__cards">`, add a new card after the Participant Audio card, using the `Captions` icon, linking to `/docs/features/subtitle-mode`, with `t('subtitleMode.title')` / `t('subtitleMode.subtitle')`.
- `web/src/pages/docs/docs.scss` — add a `.subtitle-mode-page` block. Where possible, reuse selectors by composing classnames; introduce only the rules that differ (notably a wider hero image and the comparison-pair layout for pin/lock/compact images).

### Locale files

Add a new key namespace `subtitleMode.*` plus a `nav.subtitleMode` label.

**Day-one fully translated (3 locales):** `en.ts`, `ja.ts`, `zh.ts`.
**Day-one English-fallback (9 locales, keys present with English values):** `de.ts`, `fr.ts`, `es.ts`, `it.ts`, `pt.ts`, `ru.ts`, `uk.ts`, `ko.ts`, `ar.ts`. Translating these is a follow-up task, tracked separately.

Approximate key inventory (~55 keys; per-cell keys are used for tables that have translated body cells, matching how `participantAudio.deviceGuide.*` and friends are structured):

```
nav.subtitleMode

subtitleMode.title
subtitleMode.subtitle

subtitleMode.overview.title
subtitleMode.overview.desc
subtitleMode.overview.prereq
subtitleMode.overview.extensionNote

subtitleMode.howTo.title
subtitleMode.howTo.enter
subtitleMode.howTo.exit
subtitleMode.howTo.escNote

subtitleMode.barLayout.title
subtitleMode.barLayout.desc
subtitleMode.barLayout.table.segment
subtitleMode.barLayout.table.contents
subtitleMode.barLayout.table.left
subtitleMode.barLayout.table.leftContents
subtitleMode.barLayout.table.center
subtitleMode.barLayout.table.centerContents
subtitleMode.barLayout.table.right
subtitleMode.barLayout.table.rightContents

subtitleMode.customization.title
subtitleMode.customization.desc
subtitleMode.customization.table.field       (header)
subtitleMode.customization.table.range       (header)
subtitleMode.customization.table.effect      (header)
subtitleMode.customization.row.fontSize.{field,range,effect}
subtitleMode.customization.row.compact.{field,range,effect}
subtitleMode.customization.row.bgOpacity.{field,range,effect}
subtitleMode.customization.row.bgColor.{field,range,effect}
subtitleMode.customization.row.sourceColor.{field,range,effect}
subtitleMode.customization.row.translationColor.{field,range,effect}

subtitleMode.pinLock.title
subtitleMode.pinLock.desc
subtitleMode.pinLock.table.control
subtitleMode.pinLock.table.behavior
subtitleMode.pinLock.table.pin
subtitleMode.pinLock.table.pinBehavior
subtitleMode.pinLock.table.lock
subtitleMode.pinLock.table.lockBehavior

subtitleMode.compact.title
subtitleMode.compact.desc

subtitleMode.sessionEnded.title
subtitleMode.sessionEnded.desc

subtitleMode.tips.title
subtitleMode.tips.items    (pipe-delimited; matches the existing pattern in participantAudio.tips.items)

subtitleMode.faq.title
subtitleMode.faq.q1.question
subtitleMode.faq.q1.answer
subtitleMode.faq.q2.question
subtitleMode.faq.q2.answer
subtitleMode.faq.q3.question
subtitleMode.faq.q3.answer
subtitleMode.faq.q4.question
subtitleMode.faq.q4.answer
subtitleMode.faq.q5.question
subtitleMode.faq.q5.answer
```

The pipe-delimited list pattern (`'… | … | …'.split('|').map(…)`) follows the existing `participantAudio.*` conventions so the rendering component stays consistent.

## Image Assets

All images live under `web/public/features/subtitle-mode/`. Reference from the page as `/features/subtitle-mode/<name>.png` (Vite serves `public/` at the root). The user provides these images; the implementation plan will check them into the repo before the page is shipped.

| # | Filename | Purpose | Suggested dimensions | Capture notes |
|---|---|---|---|---|
| 1 | `hero.png` | Floating subtitle bar pinned over a Google Meet or Zoom window with live ZH → EN translation visible. Establishing shot. | ~1600 × 900 | Include OS chrome of the underlying call to convey "floating above another app". Use a test meeting or blur participant names. |
| 2 | `entry-button.png` | Cropped MainPanel toolbar showing the new subtitle-mode icon button. | ~600 × 120 | Draw a red circle or arrow callout on the button. Dark theme. |
| 3 | `bar-annotated.png` | Full floating bar with numbered callouts (1)–(N) pointing at the left, center, and each control in the right cluster. | ~1400 × 80 (plus callout overhead) | Annotate in Figma / Skitch. Numbers must match the legend table order in the rendered doc. |
| 4 | `settings-popover.png` | ⚙ button clicked, popover open showing opacity slider and the four color swatches. | ~400 × 500 | Capture the popover anchored to the gear icon. |
| 5 | `pin-toggle.png` | Side-by-side: 📌 active (highlighted) vs inactive. | ~800 × 120 | Crop tight on the right cluster, both states stacked or beside each other. |
| 6 | `lock-toggle.png` | Side-by-side: 🔒 active (locked) vs inactive (drag handle cursor visible if possible). | ~800 × 120 | Same approach as pin-toggle. |
| 7 | `compact-vs-expanded.png` | Side-by-side: compact subtitle rows vs expanded rows, using the same conversation content on both sides. | ~1400 × 400 | Show at least 3 rows on each side to make the difference legible. |
| 8 | `session-ended.png` | Subtitle window in "session ended" state — placeholder message and "Return to main window" button. | ~1400 × 200 | Stop the session while in subtitle mode to trigger this state. |

**Capture guidance:**

- PNG format. Target each file < 500 KB; lossy re-encode is acceptable if needed (the lightbox is generous, not pixel-perfect).
- Sokuji's default dark theme.
- Retina / 2× display capture is fine; the lightbox will render appropriately.
- Annotations preferred over plain captures for #2 and #3 — use red or yellow circles, arrows, or numbered badges.
- Crop tightly on UI elements (do not include OS window chrome) except for the hero (#1) where the surrounding video-call window is part of the story.

## Error Handling and Edge Cases

This is documentation; runtime failure modes do not apply. Authoring concerns:

1. **Missing image at build time** — Vite does not fail builds on missing `public/` assets, but the page would render with broken images. Mitigation: the implementation plan checks each filename exists under `web/public/features/subtitle-mode/` before considering the work complete.
2. **Locale key parity** — The 9 stub locales must have every key the 3 fully-translated locales have, with English values. Mitigation: the implementation plan runs a key-diff check (or `npm run build` with strict TS, since each locale file is typed as `Record<string, string>` — missing keys won't fail the build, so a manual diff step is needed).
3. **Lightbox path mismatch** — Image paths in the JSX must match the `public/features/subtitle-mode/<name>.png` layout exactly. Mitigation: use a single `BASE_PATH = '/features/subtitle-mode'` constant in the component to centralize.
4. **Sidebar entry route mismatch** — `/docs/features/subtitle-mode` must match both the `App.tsx` route and the `DocsLayout.tsx` `path`. Single-source the literal via a comment cross-reference in both files during implementation.
5. **DocsHome card overflow** — Adding a 5th card to the Resources section is visually fine; the grid wraps. No layout change needed.

## Testing Strategy

### Automated

- `cd web && npm run build` — must succeed. TypeScript strict mode catches typos in the new locale keys' usage in `SubtitleMode.tsx`.
- `cd web && npm run lint` (if configured) — clean.

### Manual

Performed once on each of `en`, `zh`, `ja` locales, and once on a stub locale (e.g., `de`):

1. From `/docs`, click the new "Subtitle Mode" card → page loads at `/docs/features/subtitle-mode`.
2. From the sidebar, click the new "Subtitle Mode" entry → same destination, sidebar marks it active.
3. All 8 images render (no broken image icon).
4. Click each image → Lightbox opens at full size, click outside or `ESC` closes it.
5. Switch locale to `zh` and `ja` → all visible text is translated; no English leakage in the three primary locales.
6. Switch locale to `de` (stub) → page renders with English fallback values everywhere the new keys are used; existing German content elsewhere on the page remains German.
7. Page sections appear in the order listed in **User-Visible Behavior** above.
8. Tables and FAQ items render correctly (no `undefined`, no raw `|` characters from missing splits).

### Out of scope

- Visual regression / screenshot diff tests — sokuji-backend has no baseline.
- E2E (Playwright) — not used in sokuji-backend.

## Critical Files

### Created

- `web/src/pages/docs/SubtitleMode.tsx`
- `web/public/features/subtitle-mode/hero.png` *(user-provided)*
- `web/public/features/subtitle-mode/entry-button.png` *(user-provided)*
- `web/public/features/subtitle-mode/bar-annotated.png` *(user-provided)*
- `web/public/features/subtitle-mode/settings-popover.png` *(user-provided)*
- `web/public/features/subtitle-mode/pin-toggle.png` *(user-provided)*
- `web/public/features/subtitle-mode/lock-toggle.png` *(user-provided)*
- `web/public/features/subtitle-mode/compact-vs-expanded.png` *(user-provided)*
- `web/public/features/subtitle-mode/session-ended.png` *(user-provided)*

### Modified

- `web/src/App.tsx` — register the new route.
- `web/src/components/layout/DocsLayout.tsx` — add sidebar entry with `Captions` icon.
- `web/src/pages/docs/DocsHome.tsx` — add Resources card.
- `web/src/pages/docs/docs.scss` — `.subtitle-mode-page` block (mostly reusing the participant-audio rules).
- `web/src/locales/docs/en.ts` — full English copy under `subtitleMode.*` + `nav.subtitleMode`.
- `web/src/locales/docs/ja.ts` — full Japanese.
- `web/src/locales/docs/zh.ts` — full Chinese.
- `web/src/locales/docs/de.ts` — keys with English fallback.
- `web/src/locales/docs/fr.ts` — keys with English fallback.
- `web/src/locales/docs/es.ts` — keys with English fallback.
- `web/src/locales/docs/it.ts` — keys with English fallback.
- `web/src/locales/docs/pt.ts` — keys with English fallback.
- `web/src/locales/docs/ru.ts` — keys with English fallback.
- `web/src/locales/docs/uk.ts` — keys with English fallback.
- `web/src/locales/docs/ko.ts` — keys with English fallback.
- `web/src/locales/docs/ar.ts` — keys with English fallback.

### Reused as-is

- `web/src/components/docs/Lightbox.tsx`
- `web/src/lib/i18n` (`useI18n` hook)
- Existing `.participant-audio-page__*` SCSS rules (copied into `.subtitle-mode-page__*` selectors, or shared via additional classnames)

## Verification

1. **Build**:
   ```
   cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend/web
   npm run build
   ```
   Must complete with no TypeScript errors.

2. **Run locally**:
   ```
   npm run dev
   ```
   Navigate to `/docs/features/subtitle-mode`.

3. **Walk the manual test plan** in **Testing Strategy → Manual** above.

4. **Sanity-check the locale key diff**:
   ```
   # in web/src/locales/docs/
   for f in *.ts; do
     echo "=== $f ==="
     grep -c "^  'subtitleMode\." "$f"
   done
   ```
   All 12 files should print the same count (the ~55 `subtitleMode.*` keys).

5. **Image file presence**:
   ```
   ls web/public/features/subtitle-mode/
   ```
   Must list all 8 PNGs.

## Follow-up Work (out of scope for this spec)

- Translate the 9 stub locales (`de`, `fr`, `es`, `it`, `pt`, `ru`, `uk`, `ko`, `ar`) into their native languages.
- Decide whether to highlight subtitle mode on the marketing landing page (`LandingLayout.tsx` features section).
- Once browser-extension support for subtitle mode lands in a future Sokuji release, update the Overview's "extensionNote" and Tips/FAQ.
