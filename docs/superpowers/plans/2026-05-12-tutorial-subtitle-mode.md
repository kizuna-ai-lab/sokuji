# Subtitle Mode Tutorial Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new feature page at `/docs/features/subtitle-mode` to the sokuji-backend documentation site, documenting the floating Subtitle Mode shipped in Sokuji v0.26.0.

**Architecture:** Single React functional component (`SubtitleMode.tsx`) modeled on the existing `ParticipantAudio.tsx`. Reads translations from the `useI18n()` hook, embeds eight screenshots via `<img>` + `Lightbox` (matching the tutorial pages). Route registered in `App.tsx`; sidebar entry in `DocsLayout.tsx`; home card in `DocsHome.tsx`. No new dependencies, no tests added (sokuji-backend's `web/` app has no test framework configured).

**Tech Stack:** React 18 + TypeScript + Vite, `react-router-dom`, `lucide-react` icons, SCSS, in-repo `useI18n()` hook with 12 locale files.

**Spec:** `/home/jiangzhuo/Desktop/kizunaai/sokuji-react/docs/superpowers/specs/2026-05-12-tutorial-subtitle-mode-design.md`

**Working repo for ALL file changes below:** `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend/` — NOT sokuji-react. The plan file lives in sokuji-react; the implementation work happens in sokuji-backend.

---

## Pre-flight

Before starting, `cd` into the sokuji-backend repo and confirm a clean working tree:

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git status
```

Expected: `working tree clean`. If not, stash or commit existing work first. All subsequent commit commands assume you're in `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend`.

---

### Task 1: Create images directory placeholder

**Files:**
- Create: `web/public/features/subtitle-mode/README.md`

The eight screenshots are user-provided and will be added in a separate commit. This task creates a tracked placeholder so the directory exists in version control with a clear inventory of what each image must contain.

- [ ] **Step 1: Create the placeholder README**

Write the file `web/public/features/subtitle-mode/README.md` with the following exact content:

````markdown
# Subtitle Mode — Screenshot Inventory

This directory holds the eight screenshots referenced by `web/src/pages/docs/SubtitleMode.tsx`.

All files: PNG, dark-theme Sokuji UI, target <500 KB each. 2× display capture is fine.

| Filename | Purpose | Suggested dimensions | Notes |
|---|---|---|---|
| `hero.png` | Floating subtitle bar pinned over a Google Meet or Zoom window with live ZH → EN translation visible. | ~1600 × 900 | Include OS chrome of the underlying call to convey "floating above another app". Use a test meeting or blur participant names. |
| `entry-button.png` | Cropped MainPanel toolbar showing the new subtitle-mode icon button. | ~600 × 120 | Draw a red circle or arrow callout on the button. |
| `bar-annotated.png` | Full floating bar with numbered callouts (1)–(N) pointing at the left, center, and each control in the right cluster. | ~1400 × 80 (plus callout overhead) | Annotate in Figma / Skitch. Numbers must match the legend table order in the rendered doc. |
| `settings-popover.png` | ⚙ button clicked, popover open showing opacity slider and the four color swatches. | ~400 × 500 | Capture the popover anchored to the gear icon. |
| `pin-toggle.png` | Side-by-side: 📌 active (highlighted) vs inactive. | ~800 × 120 | Crop tight on the right cluster. |
| `lock-toggle.png` | Side-by-side: 🔒 active (locked) vs inactive. | ~800 × 120 | Show drag-handle cursor if possible. |
| `compact-vs-expanded.png` | Side-by-side: compact subtitle rows vs expanded rows, using the same conversation content on both sides. | ~1400 × 400 | Show at least 3 rows on each side to make the difference legible. |
| `session-ended.png` | Subtitle window in "session ended" state — placeholder message and "Return to main window" button. | ~1400 × 200 | Stop the session while in subtitle mode to trigger this state. |

Until the real images are dropped here, the documentation page will render with broken-image icons in their place. Do not link the page from production navigation until all eight files exist.
````

- [ ] **Step 2: Verify the directory exists**

Run:
```bash
ls web/public/features/subtitle-mode/
```
Expected output: `README.md`

- [ ] **Step 3: Commit**

```bash
git add web/public/features/subtitle-mode/README.md
git commit -m "$(cat <<'EOF'
docs(features): scaffold subtitle-mode image directory

Adds a tracked README enumerating the eight screenshots that will
back the new /docs/features/subtitle-mode page. Real images are
added in a follow-up commit by the documentation maintainer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add English locale keys

**Files:**
- Modify: `web/src/locales/docs/en.ts:677` (insert before the closing `};`)

- [ ] **Step 1: Append the new key block before the closing `};` in `en.ts`**

Open `web/src/locales/docs/en.ts`. Find the last existing entry (`'uninstall.copyright': '© {year} Sokuji. All rights reserved.',`) on line 676, and the `};` on line 677. Insert the following block between the last entry and the closing `};`:

```ts
  // Subtitle Mode Feature
  'nav.subtitleMode': 'Subtitle Mode',
  'subtitleMode.title': 'Subtitle Mode',
  'subtitleMode.subtitle': 'A translucent floating subtitle bar that overlays your video calls with live bilingual translation.',

  // Overview
  'subtitleMode.overview.title': 'Overview',
  'subtitleMode.overview.desc': 'Subtitle Mode shrinks Sokuji into a slim, always-on-top bar pinned to the bottom of your screen. It shows the live bilingual translation stream while you continue working in another app, joining a video call, or watching a video. The main window does not need to stay in the foreground.',
  'subtitleMode.overview.prereq': 'You can enter Subtitle Mode after starting a translation session. Subtitle Mode does not control session lifecycle — start and stop sessions from the main window.',
  'subtitleMode.overview.extensionNote': 'Subtitle Mode is available in the Sokuji desktop app (v0.26.0+) only. Browser extension support is planned for a later release.',

  // How to enter and exit
  'subtitleMode.howTo.title': 'How to Enter and Exit',
  'subtitleMode.howTo.enter': 'Once a session is active, click the subtitle icon in the main panel toolbar. The window transforms in place: the title bar hides, the bounds shift to a floating bar at the bottom of your screen, and the bar pins above other windows.',
  'subtitleMode.howTo.exit': 'To leave Subtitle Mode, press ESC while the bar is focused, or click the ✕ button on the right edge of the bar. The main window restores to its previous size and position.',
  'subtitleMode.howTo.escNote': 'The subtitle icon button is disabled until a session is active.',

  // Floating bar layout
  'subtitleMode.barLayout.title': 'Floating Bar Layout',
  'subtitleMode.barLayout.desc': 'The bar is divided into three segments. The whole bar acts as a drag region (when not locked); interactive controls opt out.',
  'subtitleMode.barLayout.table.segment': 'Segment',
  'subtitleMode.barLayout.table.contents': 'Contents',
  'subtitleMode.barLayout.table.left': 'Left',
  'subtitleMode.barLayout.table.leftContents': 'Sokuji logo and a reserved quota slot for future use.',
  'subtitleMode.barLayout.table.center': 'Center',
  'subtitleMode.barLayout.table.centerContents': 'Session timer (HH:MM:SS) and the active language pair (e.g., ZH → EN). Read-only.',
  'subtitleMode.barLayout.table.right': 'Right',
  'subtitleMode.barLayout.table.rightContents': 'Display-mode toggles (speaker / participant), font size − / +, compact toggle, Export, Clear, Settings (⚙), Pin (📌), Lock (🔒), and Exit (✕).',

  // Customization
  'subtitleMode.customization.title': 'Customization',
  'subtitleMode.customization.desc': 'Click the gear (⚙) on the right of the bar to open the settings popover. All values persist across launches.',
  'subtitleMode.customization.table.field': 'Field',
  'subtitleMode.customization.table.range': 'Range',
  'subtitleMode.customization.table.effect': 'Effect',
  'subtitleMode.customization.row.fontSize.field': 'Font size',
  'subtitleMode.customization.row.fontSize.range': '16 – 48 px',
  'subtitleMode.customization.row.fontSize.effect': 'Scales subtitle text. Bound to the − / + buttons in the bar.',
  'subtitleMode.customization.row.compact.field': 'Compact mode',
  'subtitleMode.customization.row.compact.range': 'On / Off',
  'subtitleMode.customization.row.compact.effect': 'Hides row header, language badge, and play button to maximize subtitle real estate. Default On.',
  'subtitleMode.customization.row.bgOpacity.field': 'Background opacity',
  'subtitleMode.customization.row.bgOpacity.range': '0 – 100 %',
  'subtitleMode.customization.row.bgOpacity.effect': 'Controls how transparent the bar is over the underlying window. 0% is fully transparent (text only).',
  'subtitleMode.customization.row.bgColor.field': 'Background color',
  'subtitleMode.customization.row.bgColor.range': '6-swatch palette',
  'subtitleMode.customization.row.bgColor.effect': 'Sets the bar background color. Works with the opacity slider.',
  'subtitleMode.customization.row.sourceColor.field': 'Source text color',
  'subtitleMode.customization.row.sourceColor.range': '6-swatch palette',
  'subtitleMode.customization.row.sourceColor.effect': 'Color of the recognized source-language text.',
  'subtitleMode.customization.row.translationColor.field': 'Translation text color',
  'subtitleMode.customization.row.translationColor.range': '6-swatch palette',
  'subtitleMode.customization.row.translationColor.effect': 'Color of the translated target-language text.',

  // Pin and Lock
  'subtitleMode.pinLock.title': 'Pin and Lock',
  'subtitleMode.pinLock.desc': 'Two toggles on the right of the bar control window behavior independently:',
  'subtitleMode.pinLock.table.control': 'Control',
  'subtitleMode.pinLock.table.behavior': 'Behavior',
  'subtitleMode.pinLock.table.pin': 'Pin (📌)',
  'subtitleMode.pinLock.table.pinBehavior': 'When active, the bar stays above all other windows. When off, clicking another app sends the bar to the back. Default On.',
  'subtitleMode.pinLock.table.lock': 'Lock (🔒)',
  'subtitleMode.pinLock.table.lockBehavior': 'When active, both position and size are frozen — you cannot drag the bar or resize it from the edges. Toggle off to reposition or resize. Default Off.',

  // Compact vs. expanded rows
  'subtitleMode.compact.title': 'Compact vs. Expanded Subtitle Rows',
  'subtitleMode.compact.desc': 'Subtitle Mode defaults to compact rows: a small color dot indicates the speaker, with source and translation text rendered inline. Switch off compact mode to show the full row header (with language badge and play button) — useful if you want richer context at the cost of vertical space.',

  // Session ended state
  'subtitleMode.sessionEnded.title': 'When the Session Ends',
  'subtitleMode.sessionEnded.desc': 'If the translation session stops while you are in Subtitle Mode (manual stop from another window, network drop, or provider error), the subtitle stream is replaced by a "Session ended" placeholder with a "Return to main window" button. The bar (with its ✕ button) remains visible so you can exit at any time.',

  // Tips and limitations
  'subtitleMode.tips.title': 'Tips and Limitations',
  'subtitleMode.tips.items': 'Window position and size are remembered across launches.|Source and target language cannot be changed from inside Subtitle Mode — return to the main window first.|Subtitle Mode is a presentation surface only; start and stop sessions from the main window.|Locking disables both moving and resizing; unlock to reposition.|On some older Linux desktop environments without compositor transparency, the background may render as opaque. Functionality is unaffected.',

  // FAQ
  'subtitleMode.faq.title': 'Frequently Asked Questions',
  'subtitleMode.faq.q1.question': 'Why is the Subtitle Mode button disabled?',
  'subtitleMode.faq.q1.answer': 'The button is enabled only when a translation session is active. Start a session in the main window first, then click the subtitle icon.',
  'subtitleMode.faq.q2.question': 'Does it work in the browser extension?',
  'subtitleMode.faq.q2.answer': 'No — Subtitle Mode is available in the Sokuji desktop application only (v0.26.0 and later). Browser extension support is planned for a later release.',
  'subtitleMode.faq.q3.question': 'Can I show only the translation, or only the source language?',
  'subtitleMode.faq.q3.answer': 'Yes. The Display Mode buttons in the right cluster of the bar are the same controls as in the main window — toggle each side between source-only, translation-only, or both.',
  'subtitleMode.faq.q4.question': 'How do I exit Subtitle Mode?',
  'subtitleMode.faq.q4.answer': 'Press ESC while the bar is focused, or click the ✕ button on the right edge of the bar. The window restores to its previous size and position.',
  'subtitleMode.faq.q5.question': 'Are my color and size choices remembered?',
  'subtitleMode.faq.q5.answer': 'Yes. Font size, compact mode, background opacity, background color, and the source/translation text colors all persist across app launches.',
```

- [ ] **Step 2: Verify the build still passes**

Run:
```bash
cd web && npm run build
```
Expected: TypeScript compiles without errors, Vite produces output in `web/dist/`. Return to the repo root with `cd ..`.

- [ ] **Step 3: Commit**

```bash
git add web/src/locales/docs/en.ts
git commit -m "$(cat <<'EOF'
docs(i18n): add English copy for subtitle mode page

Introduces ~55 new keys under subtitleMode.* plus nav.subtitleMode
for the v0.26.0 floating subtitle feature documentation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add Japanese locale keys

**Files:**
- Modify: `web/src/locales/docs/ja.ts` (insert before the closing `};`)

- [ ] **Step 1: Append the new key block before the closing `};` in `ja.ts`**

Open `web/src/locales/docs/ja.ts`. Insert the following block immediately before the file's closing `};` (which is followed by `export default ja;`):

```ts
  // Subtitle Mode Feature
  'nav.subtitleMode': '字幕モード',
  'subtitleMode.title': '字幕モード',
  'subtitleMode.subtitle': 'ビデオ通話の上に重ねて表示できる、半透明の浮動字幕バーで、バイリンガル翻訳をリアルタイムで表示します。',

  // Overview
  'subtitleMode.overview.title': '概要',
  'subtitleMode.overview.desc': '字幕モードは、Sokujiを画面下部に固定される細いオーバーレイバーに変形させます。他のアプリで作業したり、ビデオ通話に参加したり、動画を視聴している間も、バイリンガル翻訳ストリームをライブで表示し続けます。メインウィンドウを前面に出しておく必要はありません。',
  'subtitleMode.overview.prereq': '翻訳セッションを開始した後に字幕モードへ入ることができます。字幕モードはセッションの開始・停止を制御しません — セッションの開始・停止はメインウィンドウから行ってください。',
  'subtitleMode.overview.extensionNote': '字幕モードは Sokuji デスクトップアプリ（v0.26.0 以降）のみで利用できます。ブラウザ拡張機能でのサポートは今後のリリースで予定しています。',

  // How to enter and exit
  'subtitleMode.howTo.title': '入る・抜ける',
  'subtitleMode.howTo.enter': 'セッションがアクティブな状態で、メインパネルのツールバーにある字幕アイコンをクリックします。ウィンドウはその場で変形し、タイトルバーが非表示になり、画面下部の浮動バーへサイズが切り替わり、他のウィンドウより手前にピン留めされます。',
  'subtitleMode.howTo.exit': '字幕モードを抜けるには、バーにフォーカスがある状態で ESC を押すか、バー右端の ✕ ボタンをクリックします。メインウィンドウは元のサイズと位置に戻ります。',
  'subtitleMode.howTo.escNote': '字幕アイコンボタンは、セッションがアクティブになるまで無効化されています。',

  // Floating bar layout
  'subtitleMode.barLayout.title': '浮動バーのレイアウト',
  'subtitleMode.barLayout.desc': 'バーは3つのセグメントに分かれています。ロックを解除している間は、バー全体がドラッグ領域として機能し、インタラクティブなコントロールはドラッグ対象から外れます。',
  'subtitleMode.barLayout.table.segment': 'セグメント',
  'subtitleMode.barLayout.table.contents': '内容',
  'subtitleMode.barLayout.table.left': '左',
  'subtitleMode.barLayout.table.leftContents': 'Sokujiのロゴと、将来用に予約されているクォータスロット。',
  'subtitleMode.barLayout.table.center': '中央',
  'subtitleMode.barLayout.table.centerContents': 'セッションタイマー（HH:MM:SS）と、アクティブな言語ペア（例: ZH → EN）。読み取り専用です。',
  'subtitleMode.barLayout.table.right': '右',
  'subtitleMode.barLayout.table.rightContents': '表示モードトグル（自分／参加者）、フォントサイズ − / +、コンパクトトグル、エクスポート、クリア、設定（⚙）、ピン（📌）、ロック（🔒）、終了（✕）。',

  // Customization
  'subtitleMode.customization.title': 'カスタマイズ',
  'subtitleMode.customization.desc': 'バー右側の歯車アイコン（⚙）をクリックすると、設定ポップオーバーが開きます。すべての値は再起動後も保持されます。',
  'subtitleMode.customization.table.field': '項目',
  'subtitleMode.customization.table.range': '範囲',
  'subtitleMode.customization.table.effect': '効果',
  'subtitleMode.customization.row.fontSize.field': 'フォントサイズ',
  'subtitleMode.customization.row.fontSize.range': '16 〜 48 px',
  'subtitleMode.customization.row.fontSize.effect': '字幕テキストの大きさを変更します。バーの − / + ボタンに連動します。',
  'subtitleMode.customization.row.compact.field': 'コンパクトモード',
  'subtitleMode.customization.row.compact.range': 'オン／オフ',
  'subtitleMode.customization.row.compact.effect': '行ヘッダー、言語バッジ、再生ボタンを非表示にし、字幕の表示領域を最大化します。デフォルトはオン。',
  'subtitleMode.customization.row.bgOpacity.field': '背景の不透明度',
  'subtitleMode.customization.row.bgOpacity.range': '0 〜 100 %',
  'subtitleMode.customization.row.bgOpacity.effect': 'バーが背後のウィンドウをどれだけ透過するかを調整します。0 % は完全に透明（テキストのみ）。',
  'subtitleMode.customization.row.bgColor.field': '背景色',
  'subtitleMode.customization.row.bgColor.range': '6色のスウォッチ',
  'subtitleMode.customization.row.bgColor.effect': 'バーの背景色を設定します。不透明度スライダーと組み合わせて使えます。',
  'subtitleMode.customization.row.sourceColor.field': 'ソーステキストの色',
  'subtitleMode.customization.row.sourceColor.range': '6色のスウォッチ',
  'subtitleMode.customization.row.sourceColor.effect': '認識されたソース言語テキストの色。',
  'subtitleMode.customization.row.translationColor.field': '翻訳テキストの色',
  'subtitleMode.customization.row.translationColor.range': '6色のスウォッチ',
  'subtitleMode.customization.row.translationColor.effect': '翻訳されたターゲット言語テキストの色。',

  // Pin and Lock
  'subtitleMode.pinLock.title': 'ピンとロック',
  'subtitleMode.pinLock.desc': 'バー右側の2つのトグルが、ウィンドウの挙動を独立して制御します:',
  'subtitleMode.pinLock.table.control': 'コントロール',
  'subtitleMode.pinLock.table.behavior': '挙動',
  'subtitleMode.pinLock.table.pin': 'ピン（📌）',
  'subtitleMode.pinLock.table.pinBehavior': 'オンの間、バーは常に他のウィンドウより手前に表示されます。オフにすると、他のアプリをクリックしたときにバーが背面に隠れます。デフォルトはオン。',
  'subtitleMode.pinLock.table.lock': 'ロック（🔒）',
  'subtitleMode.pinLock.table.lockBehavior': 'オンにすると、位置とサイズの両方が固定されます — バーをドラッグしたり、端からリサイズすることはできません。位置や大きさを変えたい場合はオフにします。デフォルトはオフ。',

  // Compact vs. expanded rows
  'subtitleMode.compact.title': 'コンパクト表示と通常表示',
  'subtitleMode.compact.desc': '字幕モードはデフォルトでコンパクト行表示です: 話者を示す小さなカラードットの横に、ソーステキストと翻訳テキストがインラインで表示されます。コンパクトモードをオフにすると、行ヘッダー（言語バッジと再生ボタン付き）が表示され、より詳細な情報が得られますが、縦方向のスペースをより多く消費します。',

  // Session ended state
  'subtitleMode.sessionEnded.title': 'セッションが終了したとき',
  'subtitleMode.sessionEnded.desc': '字幕モード中に翻訳セッションが停止した場合（別のウィンドウからの手動停止、ネットワーク切断、プロバイダーエラーなど）、字幕ストリームは「セッション終了」のプレースホルダーと「メインウィンドウに戻る」ボタンに置き換わります。バー（✕ ボタン付き）は引き続き表示されるため、いつでも字幕モードを抜けることができます。',

  // Tips and limitations
  'subtitleMode.tips.title': 'ヒントと制限事項',
  'subtitleMode.tips.items': 'ウィンドウの位置とサイズは、再起動後も記憶されます。|ソース言語とターゲット言語を字幕モード内から変更することはできません — 先にメインウィンドウに戻ってください。|字幕モードは表示専用です。セッションの開始・停止はメインウィンドウから行います。|ロック中は移動とリサイズの両方が無効化されます。位置を変えるにはロックを解除してください。|コンポジターの透過機能がない一部の古い Linux デスクトップ環境では、背景が不透明に表示される場合があります。機能には影響しません。',

  // FAQ
  'subtitleMode.faq.title': 'よくある質問',
  'subtitleMode.faq.q1.question': '字幕モードのボタンが無効になっているのはなぜですか？',
  'subtitleMode.faq.q1.answer': 'ボタンは翻訳セッションがアクティブなときにのみ有効になります。先にメインウィンドウでセッションを開始してから、字幕アイコンをクリックしてください。',
  'subtitleMode.faq.q2.question': 'ブラウザ拡張機能でも動作しますか？',
  'subtitleMode.faq.q2.answer': 'いいえ — 字幕モードは Sokuji デスクトップアプリ（v0.26.0 以降）でのみ利用可能です。ブラウザ拡張機能でのサポートは今後のリリースで予定しています。',
  'subtitleMode.faq.q3.question': '翻訳だけ、またはソース言語だけを表示できますか？',
  'subtitleMode.faq.q3.answer': 'はい。バー右側にある表示モードボタンはメインウィンドウと同じコントロールで、両側それぞれをソースのみ・翻訳のみ・両方の表示に切り替えられます。',
  'subtitleMode.faq.q4.question': '字幕モードを抜けるにはどうすればよいですか？',
  'subtitleMode.faq.q4.answer': 'バーにフォーカスがある状態で ESC を押すか、バー右端の ✕ ボタンをクリックします。ウィンドウは元のサイズと位置に戻ります。',
  'subtitleMode.faq.q5.question': '色やサイズの設定は記憶されますか？',
  'subtitleMode.faq.q5.answer': 'はい。フォントサイズ、コンパクトモード、背景の不透明度、背景色、ソース／翻訳テキストの色など、すべての設定がアプリの再起動後も保持されます。',
```

- [ ] **Step 2: Verify the build still passes**

```bash
cd web && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/locales/docs/ja.ts
git commit -m "$(cat <<'EOF'
docs(i18n): add Japanese copy for subtitle mode page

Mirrors the English subtitleMode.* keys with Japanese translations.
Has been drafted; review by a native speaker is recommended before
release.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add Chinese locale keys

**Files:**
- Modify: `web/src/locales/docs/zh.ts` (insert before the closing `};`)

- [ ] **Step 1: Append the new key block before the closing `};` in `zh.ts`**

Open `web/src/locales/docs/zh.ts`. Insert the following block immediately before the closing `};` (followed by `export default zh;`):

```ts
  // Subtitle Mode Feature
  'nav.subtitleMode': '字幕模式',
  'subtitleMode.title': '字幕模式',
  'subtitleMode.subtitle': '一个半透明的悬浮字幕条，可叠加在视频通话之上，实时显示双语翻译。',

  // Overview
  'subtitleMode.overview.title': '概述',
  'subtitleMode.overview.desc': '字幕模式将 Sokuji 缩小为一条始终置顶、停靠在屏幕底部的窄条。当你在其他应用中工作、参加视频通话或观看视频时，它会持续显示实时双语翻译流。主窗口无需保持在最前面。',
  'subtitleMode.overview.prereq': '需要先开始翻译会话，才能进入字幕模式。字幕模式不控制会话生命周期 — 会话的开始和停止请在主窗口中操作。',
  'subtitleMode.overview.extensionNote': '字幕模式仅在 Sokuji 桌面应用（v0.26.0 及以上版本）中可用。浏览器扩展支持将在后续版本中提供。',

  // How to enter and exit
  'subtitleMode.howTo.title': '进入与退出',
  'subtitleMode.howTo.enter': '会话激活后，点击主面板工具栏中的字幕图标。窗口会就地变形：标题栏隐藏，尺寸切换为屏幕底部的悬浮条，并钉在其他窗口之上。',
  'subtitleMode.howTo.exit': '退出字幕模式时，可以在字幕条获得焦点的状态下按 ESC，或点击字幕条右端的 ✕ 按钮。主窗口会恢复到之前的大小和位置。',
  'subtitleMode.howTo.escNote': '在会话激活之前，字幕图标按钮处于禁用状态。',

  // Floating bar layout
  'subtitleMode.barLayout.title': '悬浮条布局',
  'subtitleMode.barLayout.desc': '字幕条分为三个区段。在未锁定时，整个字幕条都是拖动区域，可交互的控件会排除在拖动之外。',
  'subtitleMode.barLayout.table.segment': '区段',
  'subtitleMode.barLayout.table.contents': '内容',
  'subtitleMode.barLayout.table.left': '左侧',
  'subtitleMode.barLayout.table.leftContents': 'Sokuji 标志，以及保留用于将来显示配额的占位区。',
  'subtitleMode.barLayout.table.center': '中间',
  'subtitleMode.barLayout.table.centerContents': '会话计时器（HH:MM:SS）和当前语言对（如 ZH → EN）。仅供显示。',
  'subtitleMode.barLayout.table.right': '右侧',
  'subtitleMode.barLayout.table.rightContents': '显示模式切换（自己 / 参与者）、字号 − / +、紧凑模式切换、导出、清空、设置（⚙）、置顶（📌）、锁定（🔒）以及退出（✕）。',

  // Customization
  'subtitleMode.customization.title': '自定义',
  'subtitleMode.customization.desc': '点击字幕条右侧的齿轮（⚙）打开设置弹层。所有设置在重启后会保留。',
  'subtitleMode.customization.table.field': '项目',
  'subtitleMode.customization.table.range': '范围',
  'subtitleMode.customization.table.effect': '效果',
  'subtitleMode.customization.row.fontSize.field': '字号',
  'subtitleMode.customization.row.fontSize.range': '16 – 48 px',
  'subtitleMode.customization.row.fontSize.effect': '调整字幕文本大小。与字幕条上的 − / + 按钮联动。',
  'subtitleMode.customization.row.compact.field': '紧凑模式',
  'subtitleMode.customization.row.compact.range': '开 / 关',
  'subtitleMode.customization.row.compact.effect': '隐藏行头、语言标签和播放按钮，最大化字幕显示空间。默认开启。',
  'subtitleMode.customization.row.bgOpacity.field': '背景透明度',
  'subtitleMode.customization.row.bgOpacity.range': '0 – 100 %',
  'subtitleMode.customization.row.bgOpacity.effect': '控制字幕条背后窗口的透出程度。0 % 为完全透明（仅文字）。',
  'subtitleMode.customization.row.bgColor.field': '背景色',
  'subtitleMode.customization.row.bgColor.range': '6 种预设色',
  'subtitleMode.customization.row.bgColor.effect': '设置字幕条背景颜色。可与透明度滑块组合使用。',
  'subtitleMode.customization.row.sourceColor.field': '源语言文字颜色',
  'subtitleMode.customization.row.sourceColor.range': '6 种预设色',
  'subtitleMode.customization.row.sourceColor.effect': '识别出的源语言文本颜色。',
  'subtitleMode.customization.row.translationColor.field': '译文颜色',
  'subtitleMode.customization.row.translationColor.range': '6 种预设色',
  'subtitleMode.customization.row.translationColor.effect': '翻译后的目标语言文本颜色。',

  // Pin and Lock
  'subtitleMode.pinLock.title': '置顶与锁定',
  'subtitleMode.pinLock.desc': '字幕条右侧的两个开关独立控制窗口行为:',
  'subtitleMode.pinLock.table.control': '控件',
  'subtitleMode.pinLock.table.behavior': '行为',
  'subtitleMode.pinLock.table.pin': '置顶（📌）',
  'subtitleMode.pinLock.table.pinBehavior': '开启时，字幕条始终保持在其他窗口之上。关闭后，点击其他应用会让字幕条被遮挡。默认开启。',
  'subtitleMode.pinLock.table.lock': '锁定（🔒）',
  'subtitleMode.pinLock.table.lockBehavior': '开启时，位置和大小都会被冻结 — 无法拖动字幕条，也无法从边缘缩放。需要重新放置或调整大小时请关闭。默认关闭。',

  // Compact vs. expanded rows
  'subtitleMode.compact.title': '紧凑模式与展开模式对比',
  'subtitleMode.compact.desc': '字幕模式默认使用紧凑行: 一个小色点表示说话人，源语言文本与译文以行内方式呈现。关闭紧凑模式后会显示完整的行头（带语言标签和播放按钮），信息更丰富，但会占用更多垂直空间。',

  // Session ended state
  'subtitleMode.sessionEnded.title': '会话结束时',
  'subtitleMode.sessionEnded.desc': '如果在字幕模式中翻译会话停止（从其他窗口手动停止、网络断开或服务商错误），字幕流会被替换为"会话已结束"的占位提示以及一个"返回主窗口"按钮。字幕条（含 ✕ 按钮）仍然保留，因此你可以随时退出字幕模式。',

  // Tips and limitations
  'subtitleMode.tips.title': '使用提示与限制',
  'subtitleMode.tips.items': '窗口的位置和大小会在重启后保留。|无法在字幕模式中切换源语言或目标语言 — 请先返回主窗口。|字幕模式只是展示界面，会话的开始和停止请在主窗口中操作。|锁定时移动和缩放都会被禁用，需要重新调整时请解除锁定。|在某些不支持合成器透明的旧版 Linux 桌面环境中，背景可能显示为不透明，但功能不受影响。',

  // FAQ
  'subtitleMode.faq.title': '常见问题',
  'subtitleMode.faq.q1.question': '为什么字幕模式按钮是禁用的？',
  'subtitleMode.faq.q1.answer': '只有当翻译会话激活时按钮才会启用。请先在主窗口中开始一个会话，然后点击字幕图标。',
  'subtitleMode.faq.q2.question': '浏览器扩展支持字幕模式吗？',
  'subtitleMode.faq.q2.answer': '暂不支持 — 字幕模式仅在 Sokuji 桌面应用（v0.26.0 及以上版本）中可用。浏览器扩展支持将在后续版本中提供。',
  'subtitleMode.faq.q3.question': '可以只显示译文，或者只显示源语言吗？',
  'subtitleMode.faq.q3.answer': '可以。字幕条右侧的显示模式按钮与主窗口中的控件一致，可以分别将两侧切换为仅显示源语言、仅显示译文，或两者都显示。',
  'subtitleMode.faq.q4.question': '如何退出字幕模式？',
  'subtitleMode.faq.q4.answer': '在字幕条获得焦点的状态下按 ESC，或点击字幕条右端的 ✕ 按钮。窗口会恢复到之前的大小和位置。',
  'subtitleMode.faq.q5.question': '颜色和字号的设置会被记住吗？',
  'subtitleMode.faq.q5.answer': '会。字号、紧凑模式、背景透明度、背景色，以及源语言／译文的文本颜色，所有设置都会在应用重启后保留。',
```

- [ ] **Step 2: Verify the build still passes**

```bash
cd web && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/locales/docs/zh.ts
git commit -m "$(cat <<'EOF'
docs(i18n): add Chinese copy for subtitle mode page

Mirrors the English subtitleMode.* keys with Simplified Chinese
translations. Drafted; review by a native speaker recommended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add English-fallback stubs to nine other locales

**Files:**
- Modify: `web/src/locales/docs/de.ts`
- Modify: `web/src/locales/docs/fr.ts`
- Modify: `web/src/locales/docs/es.ts`
- Modify: `web/src/locales/docs/it.ts`
- Modify: `web/src/locales/docs/pt.ts`
- Modify: `web/src/locales/docs/ru.ts`
- Modify: `web/src/locales/docs/uk.ts`
- Modify: `web/src/locales/docs/ko.ts`
- Modify: `web/src/locales/docs/ar.ts`

Each of these nine files receives the **same English key block** from Task 2 (verbatim, with the leading `// Subtitle Mode Feature` comment). This preserves key parity across all locale files; translation into the target languages is a follow-up task tracked separately.

- [ ] **Step 1: Insert the English block into each of the nine files, before its closing `};`**

The block to insert is **identical** to Task 2 Step 1's block. Copy that exact content into each of the nine files, immediately before their `};` line. There are no per-file variations.

If you prefer scripted insertion, save the block from Task 2 to a temp file `/tmp/subtitle-mode-en-block.txt`, then for each target file insert it before the closing brace. A simple way:

```bash
# Save the block once
cat > /tmp/subtitle-mode-en-block.txt <<'EOF'
  // Subtitle Mode Feature
  'nav.subtitleMode': 'Subtitle Mode',
  'subtitleMode.title': 'Subtitle Mode',
  'subtitleMode.subtitle': 'A translucent floating subtitle bar that overlays your video calls with live bilingual translation.',
  ...    [rest of the block from Task 2 Step 1, identical and complete]
EOF
```

…and then patch each file. **For an actually mechanical approach**, the safest path is to open each file in an editor and paste the block before `};`. This is more reliable than scripted regex for a one-time mass insertion.

The exact same ~55 keys must end up in each of the nine files. Do not attempt to translate the values during this task; that is intentional fallback content.

- [ ] **Step 2: Verify all 12 locale files now contain the same `subtitleMode.*` key count**

Run:
```bash
cd web/src/locales/docs
for f in *.ts; do
  count=$(grep -c "^  'subtitleMode\." "$f")
  echo "$f: $count"
done
cd -
```
Expected: every line shows the same count — **68** keys starting with `subtitleMode.` (Task 2's block adds 68 such keys plus the separate `nav.subtitleMode`). If your en.ts shows 68 but a stub locale shows 67, you missed a line in that locale; diff the file against `en.ts` to find the gap.

- [ ] **Step 3: Verify the build still passes**

```bash
cd web && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/locales/docs/de.ts \
        web/src/locales/docs/fr.ts \
        web/src/locales/docs/es.ts \
        web/src/locales/docs/it.ts \
        web/src/locales/docs/pt.ts \
        web/src/locales/docs/ru.ts \
        web/src/locales/docs/uk.ts \
        web/src/locales/docs/ko.ts \
        web/src/locales/docs/ar.ts
git commit -m "$(cat <<'EOF'
docs(i18n): add subtitle-mode key stubs to nine locales

Adds the subtitleMode.* and nav.subtitleMode keys to de, fr, es, it,
pt, ru, uk, ko, and ar with English fallback values. Maintains key
parity across all 12 locale files. Native translations are a
separate follow-up task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Append `.subtitle-mode-page` SCSS block

**Files:**
- Modify: `web/src/pages/docs/docs.scss` (append at end of file, line 995+)

- [ ] **Step 1: Append the new SCSS block to docs.scss**

Open `web/src/pages/docs/docs.scss`. The current file ends at line 994 with the closing `}` of the `.participant-audio-page` block. Append the following at the end of the file (after that closing `}`, separated by a blank line):

```scss

.subtitle-mode-page {
  &__section {
    margin-bottom: var(--spacing-xl);
  }

  &__hero {
    width: 100%;
    height: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin: var(--spacing-md) 0;
    cursor: pointer;
    transition: box-shadow var(--transition-fast);

    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
  }

  &__screenshot {
    max-width: 100%;
    height: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin: var(--spacing-md) 0;
    cursor: pointer;
    transition: box-shadow var(--transition-fast);

    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
  }

  &__dual-image {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: var(--spacing-md);
    margin: var(--spacing-md) 0;

    img {
      margin: 0;
      width: 100%;
    }
  }

  &__note {
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    margin: var(--spacing-md) 0;
    font-size: var(--font-sm);
    color: var(--color-text-secondary);

    strong {
      color: var(--color-text-primary);
    }
  }

  &__tips-list {
    list-style: none;
    padding: 0;
    margin: 0;

    li {
      position: relative;
      padding-left: var(--spacing-lg);
      margin-bottom: var(--spacing-sm);
      color: var(--color-text-secondary);
      font-size: var(--font-sm);

      &::before {
        content: '💡';
        position: absolute;
        left: 0;
      }
    }
  }

  &__table-wrapper {
    overflow-x: auto;
    margin: var(--spacing-md) 0;
  }

  &__table {
    width: 100%;
    border-collapse: collapse;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin: var(--spacing-md) 0;

    th,
    td {
      padding: var(--spacing-md);
      text-align: left;
      border-bottom: 1px solid var(--color-border);
      font-size: var(--font-sm);
    }

    th {
      background: var(--color-bg-tertiary);
      font-weight: 600;
      color: var(--color-text-primary);
      white-space: nowrap;
    }

    td {
      color: var(--color-text-secondary);
    }

    tr:last-child {
      th,
      td {
        border-bottom: none;
      }
    }

    @media (max-width: 640px) {
      display: block;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
  }

  &__faq-item {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--spacing-lg);
    margin-bottom: var(--spacing-md);

    h4 {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-sm) 0;
    }

    p {
      margin: 0;
      color: var(--color-text-secondary);
      font-size: var(--font-sm);
    }
  }
}
```

- [ ] **Step 2: Verify the build still passes (SCSS will be picked up by Vite once the page imports `docs.scss`)**

```bash
cd web && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/docs/docs.scss
git commit -m "$(cat <<'EOF'
docs(style): add subtitle-mode-page SCSS block

Mirrors the participant-audio-page pattern with additions for the
full-width hero image and the side-by-side dual-image layout used
in the pin/lock comparison.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Create the SubtitleMode page component

**Files:**
- Create: `web/src/pages/docs/SubtitleMode.tsx`

- [ ] **Step 1: Create the component file**

Create `web/src/pages/docs/SubtitleMode.tsx` with the following exact content:

```tsx
/**
 * Subtitle Mode Feature Page
 *
 * Documentation for the floating Subtitle Mode introduced in v0.26.0.
 */

import { useState } from 'react';
import { Lightbox } from '@/components/docs/Lightbox';
import { useI18n } from '@/lib/i18n';
import './docs.scss';

const IMG = '/features/subtitle-mode';

export function SubtitleMode() {
  const { t } = useI18n();
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  const openLightbox = (src: string, alt: string) => setLightboxImage({ src, alt });
  const closeLightbox = () => setLightboxImage(null);

  return (
    <div className="docs-content subtitle-mode-page">
      <h1>{t('subtitleMode.title')}</h1>
      <p>{t('subtitleMode.subtitle')}</p>

      {/* Hero image */}
      <img
        src={`${IMG}/hero.png`}
        alt={t('subtitleMode.title')}
        className="subtitle-mode-page__hero"
        onClick={() => openLightbox(`${IMG}/hero.png`, t('subtitleMode.title'))}
      />

      {/* Overview */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.overview.title')}</h2>
        <p>{t('subtitleMode.overview.desc')}</p>
        <p>{t('subtitleMode.overview.prereq')}</p>
        <div className="subtitle-mode-page__note">
          {t('subtitleMode.overview.extensionNote')}
        </div>
      </section>

      {/* How to enter and exit */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.howTo.title')}</h2>
        <p>{t('subtitleMode.howTo.enter')}</p>
        <img
          src={`${IMG}/entry-button.png`}
          alt={t('subtitleMode.howTo.title')}
          className="subtitle-mode-page__screenshot"
          onClick={() => openLightbox(`${IMG}/entry-button.png`, t('subtitleMode.howTo.title'))}
        />
        <p>{t('subtitleMode.howTo.exit')}</p>
        <div className="subtitle-mode-page__note">
          {t('subtitleMode.howTo.escNote')}
        </div>
      </section>

      {/* Floating bar layout */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.barLayout.title')}</h2>
        <p>{t('subtitleMode.barLayout.desc')}</p>
        <img
          src={`${IMG}/bar-annotated.png`}
          alt={t('subtitleMode.barLayout.title')}
          className="subtitle-mode-page__screenshot"
          onClick={() => openLightbox(`${IMG}/bar-annotated.png`, t('subtitleMode.barLayout.title'))}
        />
        <div className="subtitle-mode-page__table-wrapper">
          <table className="subtitle-mode-page__table">
            <thead>
              <tr>
                <th>{t('subtitleMode.barLayout.table.segment')}</th>
                <th>{t('subtitleMode.barLayout.table.contents')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('subtitleMode.barLayout.table.left')}</td>
                <td>{t('subtitleMode.barLayout.table.leftContents')}</td>
              </tr>
              <tr>
                <td>{t('subtitleMode.barLayout.table.center')}</td>
                <td>{t('subtitleMode.barLayout.table.centerContents')}</td>
              </tr>
              <tr>
                <td>{t('subtitleMode.barLayout.table.right')}</td>
                <td>{t('subtitleMode.barLayout.table.rightContents')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Customization */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.customization.title')}</h2>
        <p>{t('subtitleMode.customization.desc')}</p>
        <img
          src={`${IMG}/settings-popover.png`}
          alt={t('subtitleMode.customization.title')}
          className="subtitle-mode-page__screenshot"
          onClick={() => openLightbox(`${IMG}/settings-popover.png`, t('subtitleMode.customization.title'))}
        />
        <div className="subtitle-mode-page__table-wrapper">
          <table className="subtitle-mode-page__table">
            <thead>
              <tr>
                <th>{t('subtitleMode.customization.table.field')}</th>
                <th>{t('subtitleMode.customization.table.range')}</th>
                <th>{t('subtitleMode.customization.table.effect')}</th>
              </tr>
            </thead>
            <tbody>
              {(['fontSize', 'compact', 'bgOpacity', 'bgColor', 'sourceColor', 'translationColor'] as const).map((row) => (
                <tr key={row}>
                  <td>{t(`subtitleMode.customization.row.${row}.field`)}</td>
                  <td>{t(`subtitleMode.customization.row.${row}.range`)}</td>
                  <td>{t(`subtitleMode.customization.row.${row}.effect`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pin and Lock */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.pinLock.title')}</h2>
        <p>{t('subtitleMode.pinLock.desc')}</p>
        <div className="subtitle-mode-page__dual-image">
          <img
            src={`${IMG}/pin-toggle.png`}
            alt={t('subtitleMode.pinLock.table.pin')}
            className="subtitle-mode-page__screenshot"
            onClick={() => openLightbox(`${IMG}/pin-toggle.png`, t('subtitleMode.pinLock.table.pin'))}
          />
          <img
            src={`${IMG}/lock-toggle.png`}
            alt={t('subtitleMode.pinLock.table.lock')}
            className="subtitle-mode-page__screenshot"
            onClick={() => openLightbox(`${IMG}/lock-toggle.png`, t('subtitleMode.pinLock.table.lock'))}
          />
        </div>
        <div className="subtitle-mode-page__table-wrapper">
          <table className="subtitle-mode-page__table">
            <thead>
              <tr>
                <th>{t('subtitleMode.pinLock.table.control')}</th>
                <th>{t('subtitleMode.pinLock.table.behavior')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('subtitleMode.pinLock.table.pin')}</td>
                <td>{t('subtitleMode.pinLock.table.pinBehavior')}</td>
              </tr>
              <tr>
                <td>{t('subtitleMode.pinLock.table.lock')}</td>
                <td>{t('subtitleMode.pinLock.table.lockBehavior')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Compact vs. expanded */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.compact.title')}</h2>
        <img
          src={`${IMG}/compact-vs-expanded.png`}
          alt={t('subtitleMode.compact.title')}
          className="subtitle-mode-page__screenshot"
          onClick={() => openLightbox(`${IMG}/compact-vs-expanded.png`, t('subtitleMode.compact.title'))}
        />
        <p>{t('subtitleMode.compact.desc')}</p>
      </section>

      {/* Session ended state */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.sessionEnded.title')}</h2>
        <img
          src={`${IMG}/session-ended.png`}
          alt={t('subtitleMode.sessionEnded.title')}
          className="subtitle-mode-page__screenshot"
          onClick={() => openLightbox(`${IMG}/session-ended.png`, t('subtitleMode.sessionEnded.title'))}
        />
        <p>{t('subtitleMode.sessionEnded.desc')}</p>
      </section>

      {/* Tips and limitations */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.tips.title')}</h2>
        <ul className="subtitle-mode-page__tips-list">
          {t('subtitleMode.tips.items').split('|').map((tip, index) => (
            <li key={index}>{tip}</li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className="subtitle-mode-page__section">
        <h2>{t('subtitleMode.faq.title')}</h2>
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <div key={n} className="subtitle-mode-page__faq-item">
            <h4>{t(`subtitleMode.faq.q${n}.question`)}</h4>
            <p>{t(`subtitleMode.faq.q${n}.answer`)}</p>
          </div>
        ))}
      </section>

      {/* Lightbox */}
      {lightboxImage && (
        <Lightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          isOpen={!!lightboxImage}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build still passes (TypeScript checks the file)**

```bash
cd web && npm run build && cd ..
```
Expected: build succeeds. The page is not yet routed, so it won't be reachable, but TypeScript validates the imports and `t()` key paths.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/docs/SubtitleMode.tsx
git commit -m "$(cat <<'EOF'
docs(features): add SubtitleMode page component

Renders the v0.26.0 subtitle-mode documentation: overview, entry/exit,
annotated floating-bar layout, customization, pin/lock, compact rows,
session-ended state, tips, and FAQ. Eight screenshots from
/features/subtitle-mode/ are wired up with the existing Lightbox.

Not yet routed; see follow-up commits for route, sidebar, and home
card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Register the route in App.tsx

**Files:**
- Modify: `web/src/App.tsx:29` (add import) and `web/src/App.tsx:129` (add route)

- [ ] **Step 1: Add the import**

In `web/src/App.tsx`, find line 29:

```tsx
import { ParticipantAudio } from './pages/docs/ParticipantAudio';
```

Add the following line immediately after it:

```tsx
import { SubtitleMode } from './pages/docs/SubtitleMode';
```

- [ ] **Step 2: Register the route**

In the same file, find line 129:

```tsx
        <Route path="features/participant-audio" element={<ParticipantAudio />} />
```

Add the following line immediately after it:

```tsx
        <Route path="features/subtitle-mode" element={<SubtitleMode />} />
```

- [ ] **Step 3: Verify the build still passes**

```bash
cd web && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 4: Smoke-test the route locally**

```bash
cd web && npm run dev
```
Open `http://localhost:5173/docs/features/subtitle-mode` in a browser. Expected: page renders with all sections; images show broken-image icons until Task 11 (or whenever the user drops in the real PNGs); no console errors related to missing translation keys.

Press Ctrl+C to stop the dev server, then `cd ..`.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx
git commit -m "$(cat <<'EOF'
docs(routing): register /docs/features/subtitle-mode

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Add the sidebar nav entry

**Files:**
- Modify: `web/src/components/layout/DocsLayout.tsx:10-24` (add Captions to icon import) and `web/src/components/layout/DocsLayout.tsx:80-81` (add nav item)

- [ ] **Step 1: Add `Captions` to the lucide-react icon import**

In `web/src/components/layout/DocsLayout.tsx`, find the existing import block (lines 10–24):

```tsx
import {
  Menu,
  X,
  Home,
  BookOpen,
  Monitor,
  Globe,
  Cpu,
  Shield,
  FileText,
  Store,
  ChevronDown,
  ExternalLink,
  Headphones,
} from 'lucide-react';
```

Change it to add `Captions` (insert it between `Headphones` and the closing `}`):

```tsx
import {
  Menu,
  X,
  Home,
  BookOpen,
  Monitor,
  Globe,
  Cpu,
  Shield,
  FileText,
  Store,
  ChevronDown,
  ExternalLink,
  Headphones,
  Captions,
} from 'lucide-react';
```

- [ ] **Step 2: Add the nav item**

In the same file, find line 80:

```tsx
  { path: '/docs/features/participant-audio', icon: Headphones, labelKey: 'nav.participantAudio' },
```

Add the following line immediately after it:

```tsx
  { path: '/docs/features/subtitle-mode', icon: Captions, labelKey: 'nav.subtitleMode' },
```

- [ ] **Step 3: Verify the build still passes**

```bash
cd web && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 4: Smoke-test the sidebar locally**

```bash
cd web && npm run dev
```
Open `http://localhost:5173/docs`. Expected: the sidebar shows a new "Subtitle Mode" entry directly under "Participant Audio", with the Captions icon. Clicking it routes to `/docs/features/subtitle-mode`.

Press Ctrl+C to stop, then `cd ..`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout/DocsLayout.tsx
git commit -m "$(cat <<'EOF'
docs(nav): add Subtitle Mode entry to docs sidebar

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add the Resources card on DocsHome

**Files:**
- Modify: `web/src/pages/docs/DocsHome.tsx:8-16` (add Captions to icon import) and `web/src/pages/docs/DocsHome.tsx:78-85` (insert new card after participant-audio card)

- [ ] **Step 1: Add `Captions` to the lucide-react icon import**

In `web/src/pages/docs/DocsHome.tsx`, find the existing import block (lines 8–16):

```tsx
import {
  Monitor,
  Globe,
  Cpu,
  Shield,
  BookOpen,
  ExternalLink,
  Users,
} from 'lucide-react';
```

Change it to add `Captions`:

```tsx
import {
  Monitor,
  Globe,
  Cpu,
  Shield,
  BookOpen,
  ExternalLink,
  Users,
  Captions,
} from 'lucide-react';
```

- [ ] **Step 2: Add the new card after the Participant Audio card**

In the same file, find the existing Participant Audio card (lines 78–85):

```tsx
          <Link to="/docs/features/participant-audio" className="docs-home__card">
            <Users size={24} />
            <div>
              <h3>{t('nav.participantAudio')}</h3>
              <p>{t('participantAudio.subtitle')}</p>
            </div>
          </Link>
```

Insert the following block immediately after it (still inside the same `<div className="docs-home__cards">`):

```tsx

          <Link to="/docs/features/subtitle-mode" className="docs-home__card">
            <Captions size={24} />
            <div>
              <h3>{t('nav.subtitleMode')}</h3>
              <p>{t('subtitleMode.subtitle')}</p>
            </div>
          </Link>
```

This mirrors the existing Participant Audio card, which uses `nav.participantAudio` for the heading and `participantAudio.subtitle` for the description.

- [ ] **Step 3: Verify the build still passes**

```bash
cd web && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 4: Smoke-test the home card locally**

```bash
cd web && npm run dev
```
Open `http://localhost:5173/docs`. Expected: in the "Resources" section, a new card "Subtitle Mode" appears with the Captions icon and the subtitle-mode tagline. Clicking it routes to `/docs/features/subtitle-mode`.

Press Ctrl+C to stop, then `cd ..`.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/docs/DocsHome.tsx
git commit -m "$(cat <<'EOF'
docs(home): add Subtitle Mode card to Resources section

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: End-to-end verification

This task has no code changes — it walks through the full feature once everything is in place. Run it after Task 10 commits.

- [ ] **Step 1: Build a fresh production bundle**

```bash
cd web && rm -rf dist && npm run build
```
Expected: build completes with no TS errors and no "missing translation" warnings. The output should include `dist/index.html` and the JS bundles.

- [ ] **Step 2: Lint**

```bash
npm run lint
```
Expected: no errors (or no new errors compared to the baseline before this work; pre-existing project warnings, if any, are out of scope).

Return to repo root: `cd ..`.

- [ ] **Step 3: Verify locale key parity**

```bash
cd web/src/locales/docs
for f in *.ts; do
  echo "=== $f ==="
  grep -c "^  'subtitleMode\." "$f"
done
cd -
```
Expected: every line shows the same integer (68). If en.ts shows 68 keys, all 11 other locales must also show 68.

- [ ] **Step 4: Verify all eight image filenames are referenced exactly once in SubtitleMode.tsx**

```bash
grep -c "/features/subtitle-mode/" web/src/pages/docs/SubtitleMode.tsx
```
Expected: at least 8 (one per `<img src=…>` plus the corresponding `openLightbox(…)` calls — actual count is 16, two per image).

- [ ] **Step 5: Walk the page manually**

```bash
cd web && npm run dev
```

Open `http://localhost:5173/docs/features/subtitle-mode` and verify each of:

1. **Page renders all sections in order**: title → subtitle → hero → Overview → How to Enter and Exit → Floating Bar Layout → Customization → Pin and Lock → Compact vs. Expanded → Session Ended → Tips → FAQ.
2. **Tables render correctly**: Floating Bar Layout has 3 rows; Customization has 6 rows; Pin and Lock has 2 rows. No `undefined` text, no raw `|` characters from the tips list.
3. **Tips list shows 5 bullets** with the 💡 leader (via CSS `::before`).
4. **FAQ shows 5 expandable-style items** (matching the participantAudio FAQ visual style — they aren't `<details>`, just styled `<div>` cards).
5. **Click each image** (hero, entry-button, bar-annotated, settings-popover, pin-toggle, lock-toggle, compact-vs-expanded, session-ended): the Lightbox opens, ESC and backdrop clicks close it. Images themselves will be broken until the user provides them; the lightbox interaction can still be verified using the broken-image icon.
6. **Locale switch**: change the locale dropdown to `zh` and `ja`; expect translated content. Change to `de` (or any of the 9 stubs); expect the English-fallback strings to appear (e.g., "Subtitle Mode" in the title).
7. **Sidebar entry**: in the left sidebar, the new "Subtitle Mode" item appears below "Participant Audio" and highlights when active.
8. **Home card**: from `/docs`, the "Subtitle Mode" card appears in the Resources section and routes to the right page.

Press Ctrl+C to stop the dev server when done.

- [ ] **Step 6 (optional): Drop in the real screenshots**

This step is the user's responsibility, but the plan flags it. Once the eight PNGs from the spec are available, copy them into `web/public/features/subtitle-mode/`. The dev server reload (or a rebuild) picks them up automatically. Then commit:

```bash
git add web/public/features/subtitle-mode/*.png
git commit -m "$(cat <<'EOF'
docs(features): add subtitle-mode screenshots

Adds the eight reference screenshots for /docs/features/subtitle-mode:
hero, entry-button, bar-annotated, settings-popover, pin-toggle,
lock-toggle, compact-vs-expanded, session-ended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Push to remote (if maintaining a remote workflow)**

Out of scope for this plan — push when the user is ready to share / open a PR.

---

## Notes for the Implementer

- All paths in this plan are relative to `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend/`. The plan file itself lives in sokuji-react but every modification listed targets the sister sokuji-backend repo.
- The sokuji-backend `web/` app has no test framework (`vitest`, `jest`, etc.) configured. Verification is "build passes + manual walkthrough". Do not attempt to add a test framework as part of this work.
- Locale files are typed as `Record<string, string>` — missing keys do not fail TypeScript compilation. The key-parity check in Task 11 Step 3 is therefore a manual safety net rather than an automatic one.
- The `useI18n()` hook returns `t(key)` that falls back to English when a key is missing in the active locale, which is why the nine stub locales work even before translation.
- `lucide-react` 0.468.0 includes the `Captions` icon. No version bump needed.
- Commit messages follow conventional commit format, mirroring the sokuji-react repo's history. Adjust if the sokuji-backend repo uses different conventions (`git log --oneline -20` to check).
