# Pronunciation ruby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A switch in the display settings that shows the other side's language with ruby readings (kana, pinyin, Korean RR, Russian/Ukrainian Latin) in the conversation panel and the Electron subtitle view.

**Architecture:** A view-layer module, `src/lib/reading/`, turns `(text, language)` into `RubyPiece[]`. Chinese, Korean and Cyrillic annotate synchronously after a lazy import; Japanese tokenizes in a worker running Lindera WASM, whose 17 MB wasm (IPADIC inside) is downloaded once from sokuji.kizuna.ai, verified and kept in IndexedDB. `RowBubble` draws the pieces as `<ruby>`; nothing touches `Row`, `Segment`, TTS or exports. A separate sokuji-backend change serves the wasm.

**Tech Stack:** React 18 + TypeScript, Zustand, Vitest (jsdom; `node` for the wasm and IndexedDB tests), Vite 8 (workers as ES modules), `pinyin-pro` 3.29.5, `lindera-wasm-ipadic-web` 2.3.4, Cloudflare Workers static assets.

**Spec:** `docs/superpowers/specs/2026-10-15-pronunciation-ruby-design.md`

## Global Constraints

- Everything in the repos is English: code, comments, test titles, commit messages (conventional commits), PR text. UI labels in tests and comments use the en catalog's words.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD: each test is written and seen failing before its code.
- Never `git push`, open a PR or merge without the owner's explicit go for that act, naming the repo and branch.
- No `console.error`/`console.warn` in `src/` (the console ledger test fails); record failures with `reportWarning`/`reportError` from `src/lib/diagnostics/report.ts`.
- Exact versions: `pinyin-pro@3.29.5`, `lindera-wasm-ipadic-web@2.3.4`.
- The wasm: URL `https://sokuji.kizuna.ai/reading/lindera-ipadic-2.3.4.wasm`, 17,750,350 bytes, SHA-256 `b37152451a13018def64d50c2f48f5d819a75fefff7bdaef039525b32aa129ac`, stored as `storeFile('reading-ja-lindera', 'lindera-ipadic-2.3.4.wasm', …)` without metadata.
- Ruby style: `rt { font-size: max(50%, 10px); opacity: 0.72; font-style: normal; line-height: 1; user-select: none }`, `ruby { ruby-position: over }`, `<rt aria-hidden="true">`.
- Which rows: `readingLanguage(rowLanguage) ∈ readingTargets(currentPairTarget)`; `rowLanguage = row.language || (translation ? languages.target : languages.source)`.
- Streaming: the last piece with a reading is drawn bare while the row is not final and ends its segment.
- Switch keys: `settings.common.conversationDisplay.showReadings`, `settings.common.subtitle.showReadings`, default `false`. The subtitle popover shows the row only in Electron while expanded.
- Strings go in all 30 catalogs. The suites cannot see localisation (`t(key, default)` returns the default): any proof that a key is read needs a keyed `t` mock.
- One analytics event: `readings_changed { surface, language, enabled }`.
- A test whose `vi.mock` factory reads a variable of the test file imports the module under test with a top-level `await import(...)` after that variable is defined, as this plan's tests do: a factory runs when its module is first imported.
- Worktrees: app work in `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/pronunciation-ruby` (branch `worktree-pronunciation-ruby`); backend work in a hand-made worktree of `~/Desktop/kizunaai/sokuji-backend` (Part A).

## Review Focus

- **Final text rewritten after the row is final** (punctuation fill-in): the row must show the new text's readings, not the old ones. Pinned in Task B11 ("re-annotates when a final row's text changes").
- **The pair moves off Japanese while the worker is starting or tokenizing:** the worker is terminated, late results are dropped, Korean rows annotate. Pinned in Task B8 ("drops a start that a stop overtook") and Task B10 ("tells the runtime when Japanese stops being wanted").
- **Local models cleared while Japanese is ready:** the next start downloads again instead of failing. Pinned in Task B8 ("downloads again when the stored file is gone").
- **A long session:** the cache stays bounded and the rows on screen keep their pieces. Pinned in Task B9 ("evicts the least recently used").
- **Text with characters outside the BMP** (𠮷) under karaoke: pieces still split on UTF-16 offsets without cutting a surrogate pair. Pinned in Task B11 ("karaoke over pieces keeps a surrogate pair whole").

---

# Part A — sokuji-backend: serve the wasm

### Task A1: `/reading/lindera-ipadic-2.3.4.wasm` as a static asset

**Files** (all in a new worktree of `~/Desktop/kizunaai/sokuji-backend`):
- Create: `web/scripts/reading-assets.mjs`
- Create: `web/scripts/reading-assets.test.ts`
- Create: `web/scripts/reading/IPADIC-COPYING.txt`
- Create: `web/public/_headers`
- Modify: `web/package.json` (devDependency, build script)

**Interfaces:**
- Produces: `copyReadingAssets({ packageDir, distDir, expected? })` (exported from `web/scripts/reading-assets.mjs`); a build output `web/dist/reading/{lindera-ipadic-2.3.4.wasm, LICENSE-lindera.txt, IPADIC-COPYING.txt}`.

- [ ] **Step 1: Make the worktree**

```bash
cd ~/Desktop/kizunaai/sokuji-backend
git fetch origin main
git worktree add .claude/worktrees/reading-wasm -b feat/reading-wasm origin/main
cd .claude/worktrees/reading-wasm
ln -sfn ../../../node_modules node_modules
echo node_modules >> "$(git rev-parse --git-common-dir)/info/exclude"
cd web && npm ci && cd ..
```

- [ ] **Step 2: Write the failing test** — `web/scripts/reading-assets.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { copyReadingAssets } from './reading-assets.mjs';

const WASM = Buffer.from('fake-wasm-bytes');
const expected = { bytes: WASM.length, sha256: createHash('sha256').update(WASM).digest('hex') };

describe('copyReadingAssets', () => {
  let packageDir: string;
  let distDir: string;
  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'reading-assets-'));
    packageDir = join(root, 'pkg');
    distDir = join(root, 'dist');
    mkdirSync(packageDir);
    mkdirSync(distDir);
    writeFileSync(join(packageDir, 'lindera_wasm_bg.wasm'), WASM);
    writeFileSync(join(packageDir, 'LICENSE'), 'MIT License (Lindera)');
  });

  it('copies the wasm under its versioned name, with both licences beside it', () => {
    copyReadingAssets({ packageDir, distDir, expected });
    expect(readFileSync(join(distDir, 'reading', 'lindera-ipadic-2.3.4.wasm'))).toEqual(WASM);
    expect(readFileSync(join(distDir, 'reading', 'LICENSE-lindera.txt'), 'utf8')).toBe('MIT License (Lindera)');
    expect(readFileSync(join(distDir, 'reading', 'IPADIC-COPYING.txt'), 'utf8')).toMatch(/Nara Institute of Science and Technology/);
  });

  it('refuses a wasm that is not the pinned one, and copies nothing', () => {
    writeFileSync(join(packageDir, 'lindera_wasm_bg.wasm'), Buffer.from('something else'));
    expect(() => copyReadingAssets({ packageDir, distDir, expected })).toThrow(/pinned/);
    expect(existsSync(join(distDir, 'reading'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run web/scripts/reading-assets.test.ts`
Expected: FAIL, cannot resolve `./reading-assets.mjs`. If vitest reports "No test files found", the root `vitest.config.ts` is not collecting `web/scripts`: add `web/scripts/**/*.test.ts` to its include and say so in the commit.

- [ ] **Step 4: Fetch the IPADIC licence verbatim**

```bash
mkdir -p web/scripts/reading
curl -fsSL https://raw.githubusercontent.com/taku910/mecab/master/mecab-ipadic/COPYING -o web/scripts/reading/IPADIC-COPYING.txt
head -3 web/scripts/reading/IPADIC-COPYING.txt
```

Expected: the file starts with a copyright line naming the Nara Institute of Science and Technology. Do not edit it.

- [ ] **Step 5: Write the script** — `web/scripts/reading-assets.mjs`

```js
/**
 * Copies Lindera's wasm (the IPADIC dictionary is inside it) into dist/reading/
 * under a versioned name, with its licence and IPADIC's. The Sokuji app downloads
 * it on first use of Japanese readings and checks the same size and SHA-256
 * (sokuji: src/lib/reading/ja/dictionary.ts), so a wasm that is not the pinned
 * one fails the build here rather than every client later.
 * Runs after `vite build` (which empties dist/).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LINDERA_VERSION = '2.3.4';
export const PINNED = { bytes: 17_750_350, sha256: 'b37152451a13018def64d50c2f48f5d819a75fefff7bdaef039525b32aa129ac' };

export function copyReadingAssets({ packageDir, distDir, expected = PINNED }) {
  const wasm = readFileSync(join(packageDir, 'lindera_wasm_bg.wasm'));
  const sha256 = createHash('sha256').update(wasm).digest('hex');
  if (wasm.length !== expected.bytes || sha256 !== expected.sha256) {
    throw new Error(`lindera_wasm_bg.wasm is not the pinned one (${wasm.length} bytes, ${sha256}); the app pins ${expected.bytes} bytes, ${expected.sha256}`);
  }
  const out = join(distDir, 'reading');
  mkdirSync(out, { recursive: true });
  copyFileSync(join(packageDir, 'lindera_wasm_bg.wasm'), join(out, `lindera-ipadic-${LINDERA_VERSION}.wasm`));
  copyFileSync(join(packageDir, 'LICENSE'), join(out, 'LICENSE-lindera.txt'));
  copyFileSync(resolve(import.meta.dirname, 'reading', 'IPADIC-COPYING.txt'), join(out, 'IPADIC-COPYING.txt'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url);
  const packageDir = dirname(require.resolve('lindera-wasm-ipadic-web/package.json'));
  copyReadingAssets({ packageDir, distDir: resolve(import.meta.dirname, '..', 'dist') });
  console.log(`dist/reading/lindera-ipadic-${LINDERA_VERSION}.wasm written`);
}
```

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run web/scripts/reading-assets.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Add the package and the build step**

```bash
cd web && npm install --save-dev --save-exact lindera-wasm-ipadic-web@2.3.4 && cd ..
```

In `web/package.json`, change `"build"` to append the copy:

```json
"build": "tsc -b && vite build && vite build --ssr src/entry-server.tsx --outDir dist-ssr && node scripts/prerender.mjs && node scripts/reading-assets.mjs",
```

- [ ] **Step 8: Add the headers** — `web/public/_headers`

```txt
# Japanese readings in the Sokuji app (sokuji src/lib/reading/ja/dictionary.ts).
# Static assets are served without the Worker, so the Hono CORS middleware never
# sees this path; the Electron renderer fetches it cross-origin. Versioned by name.
/reading/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable
```

- [ ] **Step 9: Build and check the output**

```bash
cd web && npm run build && cd ..
ls -l web/dist/reading/ && sha256sum web/dist/reading/lindera-ipadic-2.3.4.wasm && cat web/dist/_headers
```

Expected: three files in `dist/reading/`, the wasm 17750350 bytes with SHA-256 `b37152451a13018def64d50c2f48f5d819a75fefff7bdaef039525b32aa129ac`, and `_headers` copied into `dist/`.

- [ ] **Step 10: Check the headers locally**

```bash
npx wrangler dev --port 8799 &
sleep 8
curl -sI http://localhost:8799/reading/lindera-ipadic-2.3.4.wasm | grep -i -E 'access-control-allow-origin|cache-control|content-length|content-type'
kill %1
```

Expected: `access-control-allow-origin: *`, the immutable `cache-control`, and a wasm content type. If `wrangler dev` cannot start without secrets, note it and rely on Step 9 plus the post-deploy `curl` in Task B13.

- [ ] **Step 11: Run the backend gates and commit**

```bash
npx tsc --noEmit && npx vitest run
git add web/scripts/reading-assets.mjs web/scripts/reading-assets.test.ts web/scripts/reading/IPADIC-COPYING.txt web/public/_headers web/package.json web/package-lock.json
git commit -m "feat(web): serve the Lindera IPADIC wasm for Japanese readings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Stop for the owner**

Report the branch `feat/reading-wasm` in kizuna-ai-lab/sokuji-backend and ask before pushing it or opening a PR. Merging it deploys production; it must be merged and deployed before any app release that carries Part B.

---

# Part B — the app

All commands below run in `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/pronunciation-ruby`.

### Task B0: Dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
npm install --save-dev --save-exact pinyin-pro@3.29.5 lindera-wasm-ipadic-web@2.3.4
```

This gives the worktree its own `node_modules`. If `npm run electron:dev` is used later and aborts with a SUID sandbox error, run it with `ELECTRON_DISABLE_SANDBOX=1`.

- [ ] **Step 2: Confirm the wasm is the pinned one**

```bash
stat -c %s node_modules/lindera-wasm-ipadic-web/lindera_wasm_bg.wasm
sha256sum node_modules/lindera-wasm-ipadic-web/lindera_wasm_bg.wasm
```

Expected: `17750350` and `b37152451a13018def64d50c2f48f5d819a75fefff7bdaef039525b32aa129ac`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add pinyin-pro and lindera-wasm-ipadic-web for readings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B1: Reading languages

**Files:**
- Create: `src/lib/reading/types.ts`
- Create: `src/lib/reading/languages.ts`
- Test: `src/lib/reading/languages.test.ts`

**Interfaces:**
- Produces: `type ReadingLanguage = 'zh' | 'ja' | 'ko' | 'ru' | 'uk'`; `type ReadingScheme = 'pinyin' | 'kana' | 'rr' | 'latin'`; `interface RubyPiece { text: string; reading?: string }`; `READING_SCHEME: Record<ReadingLanguage, ReadingScheme>`; `readingLanguage(code: string | null | undefined): ReadingLanguage | null`; `readingTargets(target: string | null | undefined): ReadonlySet<ReadingLanguage>`.

- [ ] **Step 1: Write the failing test** — `src/lib/reading/languages.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readingLanguage, readingTargets } from './languages';

describe('readingLanguage', () => {
  it.each([
    ['zh', 'zh'], ['zh-Hans', 'zh'], ['zh-CN', 'zh'], ['cmn', 'zh'],
    ['ja', 'ja'], ['ja-JP', 'ja'], ['ko', 'ko'], ['ko-KR', 'ko'], ['ru', 'ru'], ['ru-RU', 'ru'], ['uk', 'uk'],
  ])('reads %s as %s', (code, lang) => {
    expect(readingLanguage(code)).toBe(lang);
  });

  it.each(['zh-Hant', 'zh-TW', 'zh-HK', 'zh-Hant-TW', 'yue', 'en', 'auto', 'zh+en', '', null, undefined])('has no reading language for %s', (code) => {
    expect(readingLanguage(code)).toBeNull();
  });
});

describe('readingTargets', () => {
  it("is the target's reading language", () => {
    expect([...readingTargets('ja')]).toEqual(['ja']);
  });
  it('takes each half of a bidirectional pair', () => {
    expect([...readingTargets('zh+en')]).toEqual(['zh']);
  });
  it('is empty for a target without a scheme, and for none', () => {
    expect(readingTargets('en').size).toBe(0);
    expect(readingTargets(null).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reading/languages.test.ts`
Expected: FAIL, cannot resolve `./languages`.

- [ ] **Step 3: Write the code**

`src/lib/reading/types.ts`:

```ts
/** A language Sokuji shows readings for (spec 2026-10-15 §1). */
export type ReadingLanguage = 'zh' | 'ja' | 'ko' | 'ru' | 'uk';

/** How a reading is written. */
export type ReadingScheme = 'pinyin' | 'kana' | 'rr' | 'latin';

/** A run of text and, when it has one, its reading. A row's pieces concatenate to its text exactly. */
export interface RubyPiece {
  text: string;
  reading?: string;
}

export const READING_SCHEME: Record<ReadingLanguage, ReadingScheme> = {
  zh: 'pinyin',
  ja: 'kana',
  ko: 'rr',
  ru: 'latin',
  uk: 'latin',
};
```

`src/lib/reading/languages.ts`:

```ts
import type { ReadingLanguage } from './types';

const TRADITIONAL_SUBTAGS = new Set(['hant', 'tw', 'hk', 'mo']);
const NONE: ReadonlySet<ReadingLanguage> = new Set();

/**
 * The reading language of an app language code, or null. Traditional Chinese and
 * Cantonese have none in phase 1 (pinyin-pro misreads traditional text; the spec's
 * "Measured").
 */
export function readingLanguage(code: string | null | undefined): ReadingLanguage | null {
  if (!code || code === 'auto' || code.includes('+')) return null;
  const [primary, ...subtags] = code.toLowerCase().split('-');
  if (primary === 'zh' || primary === 'cmn') {
    return subtags.some((s) => TRADITIONAL_SUBTAGS.has(s)) ? null : 'zh';
  }
  if (primary === 'ja' || primary === 'ko' || primary === 'ru' || primary === 'uk') return primary;
  return null;
}

/** The reading languages of a pair's target; a bidirectional code (`zh+en`) contributes each half (R13). */
export function readingTargets(target: string | null | undefined): ReadonlySet<ReadingLanguage> {
  if (!target) return NONE;
  const out = new Set<ReadingLanguage>();
  for (const half of target.split('+')) {
    const lang = readingLanguage(half);
    if (lang) out.add(lang);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/reading/languages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reading/types.ts src/lib/reading/languages.ts src/lib/reading/languages.test.ts
git commit -m "feat(reading): which languages get readings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B2: Chinese pinyin

**Files:**
- Create: `src/lib/reading/zh.ts`
- Test: `src/lib/reading/zh.test.ts`

**Interfaces:**
- Consumes: `RubyPiece` (B1).
- Produces: `annotateChinese(text: string): RubyPiece[]`.

- [ ] **Step 1: Write the failing test** — `src/lib/reading/zh.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { annotateChinese } from './zh';
import type { RubyPiece } from './types';

const show = (ps: RubyPiece[]) => ps.map((p) => (p.reading ? `${p.text}(${p.reading})` : p.text)).join('');

describe('annotateChinese', () => {
  it('gives each Han character its syllable, polyphones read in context', () => {
    expect(show(annotateChinese('我觉得还要重新考虑一下。'))).toBe('我(wǒ)觉(jué)得(de)还(hái)要(yào)重(chóng)新(xīn)考(kǎo)虑(lǜ)一(yí)下(xià)。');
    expect(show(annotateChinese('长城和重庆'))).toBe('长(cháng)城(chéng)和(hé)重(chóng)庆(qìng)');
    expect(show(annotateChinese('在银行门口'))).toBe('在(zài)银(yín)行(háng)门(mén)口(kǒu)');
  });

  it('keeps everything that is not Han as plain text, merged', () => {
    const pieces = annotateChinese('OK，我们');
    expect(pieces[0]).toEqual({ text: 'OK，' });
    expect(pieces.slice(1).every((p) => p.reading)).toBe(true);
  });

  it('concatenates to the input exactly', () => {
    for (const s of ['张伟说他喜欢长城。', 'Hello 世界 123', '𠮷', '']) {
      expect(annotateChinese(s).map((p) => p.text).join('')).toBe(s);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reading/zh.test.ts`
Expected: FAIL, cannot resolve `./zh`.

- [ ] **Step 3: Write the code** — `src/lib/reading/zh.ts`

```ts
import { pinyin } from 'pinyin-pro';
import type { RubyPiece } from './types';

/**
 * Pinyin with tone marks, one syllable per Han character (R10). The whole text is
 * read at once so polyphones take their context; tone sandhi (一下 yí xià) is kept
 * because readers read it aloud.
 */
export function annotateChinese(text: string): RubyPiece[] {
  const out: RubyPiece[] = [];
  for (const item of pinyin(text, { type: 'all' })) {
    if (item.isZh && item.pinyin) {
      out.push({ text: item.origin, reading: item.pinyin });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.reading === undefined) last.text += item.origin;
    else out.push({ text: item.origin });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/reading/zh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reading/zh.ts src/lib/reading/zh.test.ts
git commit -m "feat(reading): pinyin per character for Chinese

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B3: Korean Revised Romanization

**Files:**
- Create: `src/lib/reading/ko.ts`
- Test: `src/lib/reading/ko.test.ts`

**Interfaces:**
- Produces: `romanizeHangul(word: string): string`; `annotateKorean(text: string): RubyPiece[]`.

- [ ] **Step 1: Write the failing test** — `src/lib/reading/ko.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { annotateKorean, romanizeHangul } from './ko';

// Examples from the official Revised Romanization rules, plus everyday words.
const WRITES: [string, string][] = [
  ['백마', 'baengma'], ['종로', 'jongno'], ['왕십리', 'wangsimni'], ['별내', 'byeollae'], ['신라', 'silla'],
  ['해돋이', 'haedoji'], ['같이', 'gachi'], ['굳히다', 'guchida'], ['좋고', 'joko'], ['놓다', 'nota'],
  ['잡혀', 'japyeo'], ['낳지', 'nachi'], ['한라산', 'hallasan'], ['국물', 'gungmul'], ['압구정', 'apgujeong'],
  ['낙동강', 'nakdonggang'], ['울산', 'ulsan'], ['구미', 'gumi'], ['영동', 'yeongdong'], ['백암', 'baegam'],
  ['옥천', 'okcheon'], ['합덕', 'hapdeok'], ['호법', 'hobeop'], ['월곶', 'wolgot'], ['벚꽃', 'beotkkot'],
  ['한밭', 'hanbat'], ['구리', 'guri'], ['설악', 'seorak'], ['칠곡', 'chilgok'], ['임실', 'imsil'],
  ['울릉', 'ulleung'], ['대관령', 'daegwallyeong'], ['맞히다', 'machida'], ['반갑습니다', 'bangapseumnida'],
  ['있어요', 'isseoyo'], ['회의실은', 'hoeuisireun'], ['안녕하세요', 'annyeonghaseyo'], ['감사합니다', 'gamsahamnida'],
  ['좋아', 'joa'], ['많아', 'mana'], ['싫어', 'sireo'], ['놓는', 'nonneun'], ['읽고', 'ilgo'], ['읽는', 'ingneun'],
  ['닭', 'dak'], ['값', 'gap'], ['없어', 'eopseo'], ['깨끗하다', 'kkaekkeutada'], ['밝히다', 'balkida'], ['싫네', 'sille'],
];

// The spec's stated misses, pinned as they are: n-insertion, the noun aspiration exception, names.
const STATED_MISSES: [string, string][] = [
  ['학여울', 'hagyeoul'], ['알약', 'aryak'], ['묵호', 'muko'], ['집현전', 'jipyeonjeon'], ['김민수', 'gimminsu'],
];

describe('romanizeHangul', () => {
  it.each(WRITES)('writes %s as %s', (hangul, roman) => {
    expect(romanizeHangul(hangul)).toBe(roman);
  });
  it.each(STATED_MISSES)('writes %s as %s (a stated miss)', (hangul, roman) => {
    expect(romanizeHangul(hangul)).toBe(roman);
  });
});

describe('annotateKorean', () => {
  it('gives each Hangul word one reading and leaves the rest plain', () => {
    expect(annotateKorean('같이 갈까요? KTX를 타요.')).toEqual([
      { text: '같이', reading: 'gachi' }, { text: ' ' }, { text: '갈까요', reading: 'galkkayo' },
      { text: '? KTX' }, { text: '를', reading: 'reul' }, { text: ' ' }, { text: '타요', reading: 'tayo' }, { text: '.' },
    ]);
  });
  it('concatenates to the input exactly', () => {
    const s = '삼 층에 있어요. 2층?';
    expect(annotateKorean(s).map((p) => p.text).join('')).toBe(s);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reading/ko.test.ts`
Expected: FAIL, cannot resolve `./ko`.

- [ ] **Step 3: Write the code** — `src/lib/reading/ko.ts`

```ts
import type { RubyPiece } from './types';

// Revised Romanization of Korean (spec 2026-10-15 §2): the sound changes it writes
// (liaison, nasalization, lateralization, palatalization, aspiration), lower case.
// Not handled, stated: n-insertion (학여울), the noun aspiration exception (묵호), names.

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const VOWELS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const INITIAL_ROMAN: Record<string, string> = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp', ㅅ: 's',
  ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h',
};
const VOWEL_ROMAN: Record<string, string> = {
  ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo', ㅔ: 'e', ㅕ: 'yeo', ㅖ: 'ye', ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae',
  ㅚ: 'oe', ㅛ: 'yo', ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we', ㅟ: 'wi', ㅠ: 'yu', ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i',
};
/** The sound a coda is read as before a consonant or at the end of a word. */
const CODA_SOUND: Record<string, string> = {
  ㄱ: 'ㄱ', ㄲ: 'ㄱ', ㅋ: 'ㄱ', ㄳ: 'ㄱ', ㄺ: 'ㄱ',
  ㄷ: 'ㄷ', ㅅ: 'ㄷ', ㅆ: 'ㄷ', ㅈ: 'ㄷ', ㅊ: 'ㄷ', ㅌ: 'ㄷ', ㅎ: 'ㄷ',
  ㅂ: 'ㅂ', ㅍ: 'ㅂ', ㅄ: 'ㅂ', ㄿ: 'ㅂ',
  ㄴ: 'ㄴ', ㄵ: 'ㄴ', ㄶ: 'ㄴ',
  ㄹ: 'ㄹ', ㄼ: 'ㄹ', ㄽ: 'ㄹ', ㄾ: 'ㄹ', ㅀ: 'ㄹ',
  ㅁ: 'ㅁ', ㄻ: 'ㅁ', ㅇ: 'ㅇ',
};
const CODA_ROMAN: Record<string, string> = { '': '', ㄱ: 'k', ㄷ: 't', ㅂ: 'p', ㄴ: 'n', ㄹ: 'l', ㅁ: 'm', ㅇ: 'ng' };
/** A cluster before a vowel: the part that stays, the part that moves to the next syllable. */
const SPLIT: Record<string, [string, string]> = {
  ㄳ: ['ㄱ', 'ㅅ'], ㄵ: ['ㄴ', 'ㅈ'], ㄺ: ['ㄹ', 'ㄱ'], ㄻ: ['ㄹ', 'ㅁ'], ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'], ㄾ: ['ㄹ', 'ㅌ'], ㄿ: ['ㄹ', 'ㅍ'], ㅄ: ['ㅂ', 'ㅅ'],
};
const NASAL: Record<string, string> = { ㄱ: 'ㅇ', ㄷ: 'ㄴ', ㅂ: 'ㅁ' };
const ASPIRATED: Record<string, string> = { ㄱ: 'ㅋ', ㄷ: 'ㅌ', ㅂ: 'ㅍ', ㅈ: 'ㅊ' };

interface Syllable { initial: string; vowel: string; coda: string }

function decompose(ch: string): Syllable {
  const n = ch.charCodeAt(0) - 0xac00;
  return { initial: INITIALS[Math.floor(n / 588)], vowel: VOWELS[Math.floor((n % 588) / 28)], coda: FINALS[n % 28] };
}

/** The sound changes across one syllable boundary inside a word. */
function join(a: Syllable, b: Syllable): void {
  let coda = a.coda;
  if (!coda) return;
  // Liaison: a coda before a vowel moves over (palatalized before 이).
  if (b.initial === 'ㅇ') {
    if (coda === 'ㅇ') return;
    if (coda === 'ㅎ') { a.coda = ''; return; }
    if (coda === 'ㄶ' || coda === 'ㅀ') { a.coda = ''; b.initial = coda === 'ㄶ' ? 'ㄴ' : 'ㄹ'; return; }
    const [stay, moving] = SPLIT[coda] ?? ['', coda];
    let move = moving;
    if (b.vowel === 'ㅣ' && (move === 'ㄷ' || move === 'ㅌ')) move = move === 'ㄷ' ? 'ㅈ' : 'ㅊ';
    a.coda = stay;
    b.initial = move;
    return;
  }
  // ㅎ in the coda aspirates ㄱ ㄷ ㅈ, vanishes before ㅅ, and reads as ㄴ otherwise.
  if (coda === 'ㅎ' || coda === 'ㄶ' || coda === 'ㅀ') {
    const rest = coda === 'ㅎ' ? '' : coda === 'ㄶ' ? 'ㄴ' : 'ㄹ';
    if (b.initial === 'ㄱ' || b.initial === 'ㄷ' || b.initial === 'ㅈ') { a.coda = rest; b.initial = ASPIRATED[b.initial]; return; }
    if (b.initial === 'ㅅ') { a.coda = rest; return; }
    coda = rest || 'ㄴ';
    a.coda = coda;
  }
  const sound = CODA_SOUND[coda];
  // A stop before ㅎ: aspiration (ㄷ before 히 palatalizes to ㅊ).
  if (b.initial === 'ㅎ' && (sound === 'ㄱ' || sound === 'ㄷ' || sound === 'ㅂ')) {
    const base = coda === 'ㄺ' ? 'ㄱ' : coda === 'ㄼ' ? 'ㅂ' : coda === 'ㅈ' ? 'ㅈ' : sound;
    a.coda = coda === 'ㄺ' || coda === 'ㄼ' ? 'ㄹ' : '';
    b.initial = base === 'ㄷ' && b.vowel === 'ㅣ' ? 'ㅊ' : ASPIRATED[base];
    return;
  }
  if (b.initial === 'ㄹ') {
    if (sound === 'ㄹ') return;                    // ㄹㄹ, written ll
    if (sound === 'ㄴ') { a.coda = 'ㄹ'; return; } // ㄴㄹ → ㄹㄹ
    b.initial = 'ㄴ';                              // ㄹ after ㅁ ㅇ and the stops
  }
  if ((b.initial === 'ㄴ' || b.initial === 'ㅁ') && NASAL[sound]) { a.coda = NASAL[sound]; return; }
  if (b.initial === 'ㄴ' && sound === 'ㄹ') { b.initial = 'ㄹ'; return; } // ㄹㄴ → ㄹㄹ
  if (coda === 'ㄺ' && b.initial === 'ㄱ') { a.coda = 'ㄹ'; }
}

/** One Hangul word in Revised Romanization, lower case. */
export function romanizeHangul(word: string): string {
  const syllables = [...word].map(decompose);
  for (let k = 0; k + 1 < syllables.length; k++) join(syllables[k], syllables[k + 1]);
  let out = '';
  syllables.forEach((s, k) => {
    const before = k > 0 ? CODA_SOUND[syllables[k - 1].coda] : undefined;
    out += s.initial === 'ㄹ' && before === 'ㄹ' ? 'l' : INITIAL_ROMAN[s.initial];
    out += VOWEL_ROMAN[s.vowel];
    out += CODA_ROMAN[s.coda ? CODA_SOUND[s.coda] : ''];
  });
  return out;
}

const HANGUL_RUN = /([가-힣]+)/;

/** One piece per run of Hangul syllables; everything else plain. */
export function annotateKorean(text: string): RubyPiece[] {
  return text
    .split(HANGUL_RUN)
    .filter((part) => part !== '')
    .map((part) => (HANGUL_RUN.test(part) ? { text: part, reading: romanizeHangul(part) } : { text: part }));
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/reading/ko.test.ts`
Expected: PASS (55 romanizations + 2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reading/ko.ts src/lib/reading/ko.test.ts
git commit -m "feat(reading): Revised Romanization for Korean

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B4: Russian and Ukrainian transliteration

**Files:**
- Create: `src/lib/reading/cyrillic.ts`
- Test: `src/lib/reading/cyrillic.test.ts`

**Interfaces:**
- Produces: `transliterateRussian(word: string): string`; `transliterateUkrainian(word: string): string`; `annotateCyrillic(text: string, lang: 'ru' | 'uk'): RubyPiece[]`.

- [ ] **Step 1: Write the failing test** — `src/lib/reading/cyrillic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { annotateCyrillic, transliterateRussian, transliterateUkrainian } from './cyrillic';

const RUSSIAN: [string, string][] = [
  ['Москва', 'moskva'], ['Ельцин', 'yeltsin'], ['Пётр', 'pyotr'], ['Счастливого', 'schastlivogo'], ['Хорошо', 'khorosho'],
  ['Подъезд', 'podyezd'], ['Объём', 'obyom'], ['Щука', 'shchuka'], ['Юрий', 'yuriy'], ['Чайковский', 'chaykovskiy'],
  ['Мария', 'mariya'], ['Белый', 'belyy'], ['Спасибо', 'spasibo'], ['встречи', 'vstrechi'], ['поезд', 'poyezd'],
];
// Examples from the official table of Ukraine's 2010 system, lower case.
const UKRAINIAN: [string, string][] = [
  ['Алушта', 'alushta'], ['Андрій', 'andrii'], ['Борщагівка', 'borshchahivka'], ['Вінниця', 'vinnytsia'], ['Гадяч', 'hadiach'],
  ['Згорани', 'zghorany'], ['Ґалаґан', 'galagan'], ['Єнакієве', 'yenakiieve'], ['Наєнко', 'naienko'], ['Житомир', 'zhytomyr'],
  ['Йосипівка', 'yosypivka'], ['Стрий', 'stryi'], ['Їжакевич', 'yizhakevych'], ['Кадиївка', 'kadyivka'], ['Юрій', 'yurii'],
  ['Крюківка', 'kriukivka'], ['Яготин', 'yahotyn'], ['Костянтин', 'kostiantyn'], ["Знам'янка", 'znamianka'],
  ['Щербухи', 'shcherbukhy'], ['Олексій', 'oleksii'], ['Рівне', 'rivne'], ['Харків', 'kharkiv'],
];

describe('transliterateRussian (BGN/PCGN, ASCII)', () => {
  it.each(RUSSIAN)('writes %s as %s', (word, latin) => expect(transliterateRussian(word)).toBe(latin));
});

describe('transliterateUkrainian (2010 national system)', () => {
  it.each(UKRAINIAN)('writes %s as %s', (word, latin) => expect(transliterateUkrainian(word)).toBe(latin));
});

describe('annotateCyrillic', () => {
  it('gives each word one reading, an apostrophe inside a word kept with it', () => {
    expect(annotateCyrillic("Знам'янка, до зустрічі!", 'uk')).toEqual([
      { text: "Знам'янка", reading: 'znamianka' }, { text: ', ' }, { text: 'до', reading: 'do' }, { text: ' ' },
      { text: 'зустрічі', reading: 'zustrichi' }, { text: '!' },
    ]);
  });
  it('uses the table of the language asked for', () => {
    expect(annotateCyrillic('Юрий', 'ru')[0].reading).toBe('yuriy');
    expect(annotateCyrillic('Юрій', 'uk')[0].reading).toBe('yurii');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reading/cyrillic.test.ts`
Expected: FAIL, cannot resolve `./cyrillic`.

- [ ] **Step 3: Write the code** — `src/lib/reading/cyrillic.ts`

```ts
import type { RubyPiece } from './types';

const RUSSIAN_SOFTENERS = 'аеёиоуыэюяйъь';
/** BGN/PCGN in ASCII: the soft and hard signs are dropped, ё is written yo. */
const RUSSIAN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ё: 'yo',
};

export function transliterateRussian(word: string): string {
  const w = word.toLowerCase();
  let out = '';
  for (let k = 0; k < w.length; k++) {
    const c = w[k];
    if (c === 'е') out += k === 0 || RUSSIAN_SOFTENERS.includes(w[k - 1]) ? 'ye' : 'e';
    else out += RUSSIAN[c] ?? c;
  }
  return out;
}

/** Ukraine's national system (Cabinet of Ministers resolution 55, 2010); the apostrophe is not written. */
const UKRAINIAN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'y', і: 'i', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ь: '', "'": '', '’': '', 'ʼ': '',
};
/** Letters written one way at the start of a word and another elsewhere. */
const UKRAINIAN_INITIAL: Record<string, [string, string]> = {
  є: ['ye', 'ie'], ї: ['yi', 'i'], й: ['y', 'i'], ю: ['yu', 'iu'], я: ['ya', 'ia'],
};

export function transliterateUkrainian(word: string): string {
  const w = word.toLowerCase();
  let out = '';
  for (let k = 0; k < w.length; k++) {
    const c = w[k];
    if (UKRAINIAN_INITIAL[c]) out += UKRAINIAN_INITIAL[c][k === 0 ? 0 : 1];
    else if (c === 'г' && w[k - 1] === 'з') out += 'gh';
    else out += UKRAINIAN[c] ?? c;
  }
  return out;
}

const CYRILLIC_WORD = /([Ѐ-ӿ]+(?:['’ʼ][Ѐ-ӿ]+)*)/;

/** One piece per Cyrillic word; everything else plain. Transliteration spells letters, not pronunciation. */
export function annotateCyrillic(text: string, lang: 'ru' | 'uk'): RubyPiece[] {
  const write = lang === 'ru' ? transliterateRussian : transliterateUkrainian;
  return text
    .split(CYRILLIC_WORD)
    .filter((part) => part !== '')
    .map((part) => (CYRILLIC_WORD.test(part) ? { text: part, reading: write(part) } : { text: part }));
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/reading/cyrillic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reading/cyrillic.ts src/lib/reading/cyrillic.test.ts
git commit -m "feat(reading): Latin transliteration for Russian and Ukrainian

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B5: Japanese furigana

**Files:**
- Create: `src/lib/reading/ja/furigana.ts`
- Test: `src/lib/reading/ja/furigana.test.ts`
- Test: `src/lib/reading/ja/furigana.lindera.test.ts`

**Interfaces:**
- Produces: `interface JaToken { surface: string; reading: string | null; unknown: boolean }` (reading in katakana, as IPADIC gives it); `toHiragana(s: string): string`; `furigana(tokens: readonly JaToken[]): RubyPiece[]`.

- [ ] **Step 1: Write the failing unit test** — `src/lib/reading/ja/furigana.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { furigana, toHiragana, type JaToken } from './furigana';
import type { RubyPiece } from '../types';

const tok = (surface: string, reading: string | null, unknown = false): JaToken => ({ surface, reading, unknown });
const show = (ps: RubyPiece[]) => ps.map((p) => (p.reading ? `${p.text}(${p.reading})` : p.text)).join('');

describe('furigana', () => {
  it('puts kana on the Han runs only, okurigana bare', () => {
    expect(show(furigana([tok('考え直す', 'カンガエナオス'), tok('必要', 'ヒツヨウ')]))).toBe('考(かんが)え直(なお)す必要(ひつよう)');
    expect(show(furigana([tok('会い', 'アイ'), tok('ましょ', 'マショ'), tok('う', 'ウ')]))).toBe('会(あ)いましょう');
  });

  it('leaves kana-only tokens bare and merges them', () => {
    expect(furigana([tok('この', 'コノ'), tok('は', 'ハ')])).toEqual([{ text: 'このは' }]);
  });

  it('gives a token whose reading does not line up its whole reading', () => {
    expect(furigana([tok('明日', 'アシタ')])).toEqual([{ text: '明日', reading: 'あした' }]);
    expect(furigana([tok('一か月', 'イッカゲツ')])).toEqual([{ text: '一', reading: 'いっ' }, { text: 'か' }, { text: '月', reading: 'げつ' }]);
  });

  it('leaves an unknown token bare, and the whole unbroken Han run around it', () => {
    // 蒼汰: the dictionary knows 蒼 as a surname (あおい) but not 汰.
    expect(show(furigana([tok('蒼', 'アオイ'), tok('汰', null, true), tok('くん', 'クン')]))).toBe('蒼汰くん');
    // 𠮷野家: an unknown 𠮷 plus 野家 (のや).
    expect(show(furigana([tok('𠮷', null), tok('野家', 'ノヤ'), tok('に', 'ニ'), tok('行っ', 'イッ')]))).toBe('𠮷野家に行(い)っ');
  });

  it('concatenates to the input exactly', () => {
    const tokens = [tok('今日', 'キョウ'), tok('は', 'ハ'), tok('ＡＢＣ', null, true), tok('で', 'デ')];
    expect(furigana(tokens).map((p) => p.text).join('')).toBe('今日はＡＢＣで');
  });
});

describe('toHiragana', () => {
  it('turns katakana into hiragana and leaves the rest', () => {
    expect(toHiragana('カンガエナオス・ヴー')).toBe('かんがえなおす・ゔー');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reading/ja/furigana.test.ts`
Expected: FAIL, cannot resolve `./furigana`.

- [ ] **Step 3: Write the code** — `src/lib/reading/ja/furigana.ts`

```ts
import type { RubyPiece } from '../types';

/** One Lindera token: its surface, IPADIC's reading (katakana) or null, and whether the dictionary knew it. */
export interface JaToken {
  surface: string;
  reading: string | null;
  unknown: boolean;
}

const HAN_CLASS = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u{20000}-\\u{3134f}々〆';
const HAN = new RegExp(`[${HAN_CLASS}]`, 'u');
const RUNS = new RegExp(`[${HAN_CLASS}]+|[^${HAN_CLASS}]+`, 'gu');

export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Furigana for one known token: on its Han runs only, its kana left bare. */
function tokenPieces(surface: string, reading: string): RubyPiece[] {
  const kana = toHiragana(reading);
  const runs = surface.match(RUNS) ?? [surface];
  const pattern = runs
    .map((r) => (HAN.test(r) ? '(.+?)' : toHiragana(r).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const match = kana.match(new RegExp(`^${pattern}$`, 'u'));
  if (!match) return [{ text: surface, reading: kana }];
  let group = 1;
  return runs.map((r) => (HAN.test(r) ? { text: r, reading: match[group++] } : { text: r }));
}

/**
 * Furigana for a tokenized sentence. Conservative on names and slang (#545): a
 * token the dictionary does not know gets no reading, and neither does any token
 * in the same unbroken run of Han-bearing tokens, which is usually one word the
 * dictionary lacks split into pieces it half-knows (蒼汰, 𠮷野家).
 */
export function furigana(tokens: readonly JaToken[]): RubyPiece[] {
  const out: RubyPiece[] = [];
  const push = (piece: RubyPiece) => {
    const last = out[out.length - 1];
    if (piece.reading === undefined && last && last.reading === undefined) last.text += piece.text;
    else out.push({ ...piece });
  };
  for (let k = 0; k < tokens.length;) {
    if (!HAN.test(tokens[k].surface)) {
      push({ text: tokens[k].surface });
      k++;
      continue;
    }
    let end = k;
    while (end < tokens.length && HAN.test(tokens[end].surface)) end++;
    const run = tokens.slice(k, end);
    const bare = run.some((t) => t.unknown || !t.reading);
    for (const t of run) {
      if (bare) push({ text: t.surface });
      else for (const piece of tokenPieces(t.surface, t.reading!)) push(piece);
    }
    k = end;
  }
  return out;
}
```

- [ ] **Step 4: Run the unit test to see it pass**

Run: `npx vitest run src/lib/reading/ja/furigana.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the Lindera test** — `src/lib/reading/ja/furigana.lindera.test.ts`

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync, TokenizerBuilder, type Tokenizer } from 'lindera-wasm-ipadic-web';
import { furigana, type JaToken } from './furigana';
import type { RubyPiece } from '../types';

const require = createRequire(import.meta.url);
let tokenizer: Tokenizer;

beforeAll(() => {
  initSync({ module: readFileSync(require.resolve('lindera-wasm-ipadic-web/lindera_wasm_bg.wasm')) });
  const builder = new TokenizerBuilder();
  builder.setDictionary('embedded://ipadic');
  builder.setMode('normal');
  tokenizer = builder.build();
});

// The worker's own mapping (lindera.worker.ts) in miniature.
const tokenize = (text: string): JaToken[] => tokenizer.tokenize(text).map((t) => {
  const reading = t.details[7];
  const token = { surface: t.surface, reading: reading && reading !== '*' ? reading : null, unknown: t.is_unknown };
  t.free();
  return token;
});
const show = (ps: RubyPiece[]) => ps.map((p) => (p.reading ? `${p.text}(${p.reading})` : p.text)).join('');

describe('furigana over Lindera IPADIC', () => {
  it.each([
    ['この問題はまだ解決されていないので、もう一度考え直す必要があると思います。', 'この問題(もんだい)はまだ解決(かいけつ)されていないので、もう一度(いちど)考(かんが)え直(なお)す必要(ひつよう)があると思(おも)います。'],
    ['明日の午後三時に銀行の前で会いましょうか？', '明日(あした)の午後(ごご)三(さん)時(じ)に銀行(ぎんこう)の前(まえ)で会(あ)いましょうか？'],
    ['今日は生憎の雨ですね', '今日(きょう)は生憎(あいにく)の雨(あめ)ですね'],
    ['蒼汰くんが𠮷野家に行った', '蒼汰くんが𠮷野家に行(い)った'],
  ])('reads %s', (text, expected) => {
    expect(show(furigana(tokenize(text)))).toBe(expected);
  });

  it('reads 令和 wrongly, as the spec states (IPADIC predates it)', () => {
    expect(show(furigana(tokenize('令和')))).toBe('令(りょう)和(わ)');
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/lib/reading/ja/furigana.lindera.test.ts`
Expected: PASS. If `t.is_unknown` or `t.details` is undefined, read `node_modules/lindera-wasm-ipadic-web/lindera_wasm.d.ts` for the 2.3.4 names and fix both this test and Task B7's worker the same way.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reading/ja/furigana.ts src/lib/reading/ja/furigana.test.ts src/lib/reading/ja/furigana.lindera.test.ts
git commit -m "feat(reading): furigana over Lindera tokens, bare on unknown runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B6: Japanese dictionary download and storage

**Files:**
- Create: `src/lib/reading/ja/dictionary.ts`
- Test: `src/lib/reading/ja/dictionary.test.ts`

**Interfaces:**
- Consumes: `storeFile`, `getFile`, `deleteModelFiles` (`src/lib/local-inference/modelStorage.ts`); `retryWithBackoff`, `fetchWithConnectTimeout`, `readStreamToBlob` (`src/lib/local-inference/downloadRetry.ts`).
- Produces: constants `LINDERA_VERSION`, `DICTIONARY_FILE`, `DICTIONARY_URL`, `DICTIONARY_BYTES`, `DICTIONARY_SHA256`, `DICTIONARY_STORE_ID`; `class DictionaryIntegrityError`; `storedDictionary(expectedBytes?: number): Promise<ArrayBuffer | null>`; `downloadDictionary(opts: DictionaryOptions): Promise<ArrayBuffer>` where `DictionaryOptions = { signal: AbortSignal; onProgress?: (done: number, total: number) => void; fetchImpl?: typeof fetch; expected?: { bytes: number; sha256: string }; sleep?: (ms: number) => Promise<void> }`.

- [ ] **Step 1: Write the failing test** — `src/lib/reading/ja/dictionary.test.ts`

```ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { getFile, storeFile, clearAll } from '../../local-inference/modelStorage';
import {
  DICTIONARY_FILE, DICTIONARY_STORE_ID, DICTIONARY_URL, DictionaryIntegrityError, downloadDictionary, storedDictionary,
} from './dictionary';

const BYTES = new TextEncoder().encode('fake lindera wasm');
const expected = { bytes: BYTES.length, sha256: createHash('sha256').update(BYTES).digest('hex') };
const respond = (body: Uint8Array | string, status = 200) => vi.fn(async () => new Response(body, { status }));
const noSleep = async () => {};

describe('the Japanese dictionary', () => {
  beforeEach(async () => { await clearAll(); });

  it('downloads from the pinned URL, checks it, stores it and reports progress against the pinned size', async () => {
    const fetchImpl = respond(BYTES);
    const progress = vi.fn();
    const buf = await downloadDictionary({ signal: new AbortController().signal, fetchImpl, expected, onProgress: progress, sleep: noSleep });
    expect(new Uint8Array(buf)).toEqual(BYTES);
    expect(fetchImpl.mock.calls[0][0]).toBe(DICTIONARY_URL);
    expect(progress).toHaveBeenLastCalledWith(BYTES.length, BYTES.length);
    expect((await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE))?.size).toBe(BYTES.length);
    expect(new Uint8Array((await storedDictionary(BYTES.length))!)).toEqual(BYTES);
  });

  it("refuses the site's index.html answered with 200 for a missing path, stores nothing, and does not retry", async () => {
    const fetchImpl = respond('<!doctype html><title>Sokuji</title>');
    await expect(downloadDictionary({ signal: new AbortController().signal, fetchImpl, expected, sleep: noSleep }))
      .rejects.toBeInstanceOf(DictionaryIntegrityError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE)).toBeUndefined();
  });

  it('refuses bytes of the right size but the wrong hash', async () => {
    const wrong = new Uint8Array(BYTES.length).fill(7);
    await expect(downloadDictionary({ signal: new AbortController().signal, fetchImpl: respond(wrong), expected, sleep: noSleep }))
      .rejects.toThrow(/SHA-256/);
  });

  it('retries a failed request', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(BYTES, { status: 200 }));
    await downloadDictionary({ signal: new AbortController().signal, fetchImpl, expected, sleep: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects with an AbortError when aborted, and stores nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(downloadDictionary({ signal: controller.signal, fetchImpl: respond(BYTES), expected, sleep: noSleep }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE)).toBeUndefined();
  });

  it('deletes an older version when it stores a new one', async () => {
    await storeFile(DICTIONARY_STORE_ID, 'lindera-ipadic-2.3.3.wasm', new Blob(['old']));
    await downloadDictionary({ signal: new AbortController().signal, fetchImpl: respond(BYTES), expected, sleep: noSleep });
    expect(await getFile(DICTIONARY_STORE_ID, 'lindera-ipadic-2.3.3.wasm')).toBeUndefined();
  });

  it('treats a stored file of another size as not stored', async () => {
    await storeFile(DICTIONARY_STORE_ID, DICTIONARY_FILE, new Blob(['short']));
    expect(await storedDictionary(BYTES.length)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reading/ja/dictionary.test.ts`
Expected: FAIL, cannot resolve `./dictionary`.

- [ ] **Step 3: Write the code** — `src/lib/reading/ja/dictionary.ts`

```ts
import { deleteModelFiles, getFile, storeFile } from '../../local-inference/modelStorage';
import { fetchWithConnectTimeout, readStreamToBlob, retryWithBackoff } from '../../local-inference/downloadRetry';

// Lindera's wasm carries the IPADIC dictionary. sokuji-backend serves it
// (web/scripts/reading-assets.mjs pins the same size and hash); a path it does
// not have answers 200 with the site's index.html, so size and hash are checked.
export const LINDERA_VERSION = '2.3.4';
export const DICTIONARY_FILE = `lindera-ipadic-${LINDERA_VERSION}.wasm`;
export const DICTIONARY_URL = `https://sokuji.kizuna.ai/reading/${DICTIONARY_FILE}`;
export const DICTIONARY_BYTES = 17_750_350;
export const DICTIONARY_SHA256 = 'b37152451a13018def64d50c2f48f5d819a75fefff7bdaef039525b32aa129ac';
/** Its key prefix in `sokuji-models`. No metadata is written, so the Models UI does not list it. */
export const DICTIONARY_STORE_ID = 'reading-ja-lindera';

export class DictionaryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DictionaryIntegrityError';
  }
}

export interface DictionaryOptions {
  signal: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  fetchImpl?: typeof fetch;
  expected?: { bytes: number; sha256: string };
  sleep?: (ms: number) => Promise<void>;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The stored dictionary's bytes, or null when it is not stored at the size this version pins. */
export async function storedDictionary(expectedBytes = DICTIONARY_BYTES): Promise<ArrayBuffer | null> {
  const blob = await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE);
  if (!blob || blob.size !== expectedBytes) return null;
  return blob.arrayBuffer();
}

/** Downloads, checks and stores the dictionary, replacing any other version; resolves with its bytes. */
export async function downloadDictionary(opts: DictionaryOptions): Promise<ArrayBuffer> {
  const { signal, onProgress, fetchImpl, sleep } = opts;
  const expected = opts.expected ?? { bytes: DICTIONARY_BYTES, sha256: DICTIONARY_SHA256 };
  const bytes = await retryWithBackoff(async () => {
    const res = await fetchWithConnectTimeout(DICTIONARY_URL, { timeoutMs: 30_000, signal, fetchImpl });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${DICTIONARY_URL}`);
    const blob = await readStreamToBlob(res.body.getReader(), {
      stallTimeoutMs: 30_000,
      signal,
      onProgress: (done) => onProgress?.(done, expected.bytes),
    });
    const buf = await blob.arrayBuffer();
    if (buf.byteLength !== expected.bytes) {
      throw new DictionaryIntegrityError(`Expected ${expected.bytes} bytes from ${DICTIONARY_URL}, got ${buf.byteLength}`);
    }
    if ((await sha256Hex(buf)) !== expected.sha256) {
      throw new DictionaryIntegrityError(`SHA-256 of ${DICTIONARY_URL} does not match the pinned one`);
    }
    return buf;
  }, {
    attempts: 3,
    backoffsMs: [1_000, 3_000],
    sleep,
    shouldRetry: (err) => (err as Error)?.name !== 'AbortError' && !(err instanceof DictionaryIntegrityError),
  });
  await deleteModelFiles(DICTIONARY_STORE_ID);
  await storeFile(DICTIONARY_STORE_ID, DICTIONARY_FILE, new Blob([bytes], { type: 'application/wasm' }));
  return bytes;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/reading/ja/dictionary.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reading/ja/dictionary.ts src/lib/reading/ja/dictionary.test.ts
git commit -m "feat(reading): download, check and keep the Japanese dictionary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B7: The Lindera worker, its client, and keeping the wasm out of the build

**Files:**
- Create: `src/lib/reading/ja/protocol.ts`
- Create: `src/lib/reading/ja/lindera.worker.ts`
- Create: `src/lib/reading/ja/createLinderaWorker.ts`
- Create: `src/lib/reading/ja/client.ts`
- Test: `src/lib/reading/ja/client.test.ts`
- Create: `vite.lindera-wasm-url.ts`
- Test: `vite.lindera-wasm-url.test.ts`
- Create: `scripts/check-no-lindera-wasm.mjs`
- Modify: `vite.config.ts` (plugins, worker.plugins), `extension/vite.config.ts` (same)

**Interfaces:**
- Consumes: `JaToken` (B5).
- Produces: `startJaClient(wasm: ArrayBuffer): Promise<JaClient>` with `interface JaClient { tokenize(text: string): Promise<JaToken[] | null>; terminate(): void }` (`tokenize` resolves null once the worker is gone); `linderaWasmUrl(): Plugin`.

- [ ] **Step 1: Write the failing client test** — `src/lib/reading/ja/client.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FromLinderaWorker, ToLinderaWorker } from './protocol';

class FakeWorker {
  static last: FakeWorker;
  sent: { msg: ToLinderaWorker; transfer?: Transferable[] }[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<FromLinderaWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() { FakeWorker.last = this; }
  postMessage(msg: ToLinderaWorker, transfer?: Transferable[]) { this.sent.push({ msg, transfer }); }
  terminate() { this.terminated = true; }
  answer(data: FromLinderaWorker) { this.onmessage?.({ data } as MessageEvent<FromLinderaWorker>); }
}

vi.mock('./createLinderaWorker', () => ({ createLinderaWorker: () => new FakeWorker() }));

const { startJaClient } = await import('./client');

describe('startJaClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transfers the wasm, resolves on ready, and answers tokenize by id', async () => {
    const wasm = new ArrayBuffer(8);
    const started = startJaClient(wasm);
    const worker = FakeWorker.last;
    expect(worker.sent[0].msg).toEqual({ type: 'init', wasm });
    expect(worker.sent[0].transfer).toEqual([wasm]);
    worker.answer({ type: 'ready' });
    const client = await started;

    const a = client.tokenize('一');
    const b = client.tokenize('二');
    const [first, second] = worker.sent.slice(1).map((s) => s.msg) as Extract<ToLinderaWorker, { type: 'tokenize' }>[];
    worker.answer({ type: 'tokens', id: second.id, tokens: [{ surface: '二', reading: 'ニ', unknown: false }] });
    worker.answer({ type: 'tokens', id: first.id, tokens: [{ surface: '一', reading: 'イチ', unknown: false }] });
    expect(await a).toEqual([{ surface: '一', reading: 'イチ', unknown: false }]);
    expect(await b).toEqual([{ surface: '二', reading: 'ニ', unknown: false }]);
  });

  it('rejects and terminates when the worker cannot start', async () => {
    const started = startJaClient(new ArrayBuffer(8));
    const worker = FakeWorker.last;
    worker.answer({ type: 'failed', message: 'CompileError' });
    await expect(started).rejects.toThrow('CompileError');
    expect(worker.terminated).toBe(true);
  });

  it('resolves pending requests with null on terminate', async () => {
    const started = startJaClient(new ArrayBuffer(8));
    FakeWorker.last.answer({ type: 'ready' });
    const client = await started;
    const pending = client.tokenize('三');
    client.terminate();
    expect(await pending).toBeNull();
    expect(FakeWorker.last.terminated).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reading/ja/client.test.ts`
Expected: FAIL, cannot resolve `./protocol` / `./client`.

- [ ] **Step 3: Write the protocol, worker, factory and client**

`src/lib/reading/ja/protocol.ts`:

```ts
import type { JaToken } from './furigana';

export type ToLinderaWorker =
  | { type: 'init'; wasm: ArrayBuffer }
  | { type: 'tokenize'; id: number; text: string };

export type FromLinderaWorker =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'tokens'; id: number; tokens: JaToken[] | null };
```

`src/lib/reading/ja/lindera.worker.ts`:

```ts
/// <reference lib="webworker" />
import init, { TokenizerBuilder, type Tokenizer } from 'lindera-wasm-ipadic-web';
import type { JaToken } from './furigana';
import type { FromLinderaWorker, ToLinderaWorker } from './protocol';

// Instantiated from the bytes the app stored, never fetched: the build strips the
// glue's own wasm URL (vite.lindera-wasm-url.ts).
let tokenizer: Tokenizer | null = null;
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: FromLinderaWorker) => scope.postMessage(msg);

scope.onmessage = async (e: MessageEvent<ToLinderaWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await init({ module_or_path: msg.wasm });
      const builder = new TokenizerBuilder();
      builder.setDictionary('embedded://ipadic');
      builder.setMode('normal');
      tokenizer = builder.build();
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (!tokenizer) {
    post({ type: 'tokens', id: msg.id, tokens: null });
    return;
  }
  const tokens: JaToken[] = tokenizer.tokenize(msg.text).map((t) => {
    const reading = t.details[7];
    const token = { surface: t.surface, reading: reading && reading !== '*' ? reading : null, unknown: t.is_unknown };
    t.free();
    return token;
  });
  post({ type: 'tokens', id: msg.id, tokens });
};
```

`src/lib/reading/ja/createLinderaWorker.ts`:

```ts
/** Isolated factory so the client can be unit-tested with the worker stubbed. */
export function createLinderaWorker(): Worker {
  return new Worker(new URL('./lindera.worker.ts', import.meta.url), { type: 'module' });
}
```

`src/lib/reading/ja/client.ts`:

```ts
import { createLinderaWorker } from './createLinderaWorker';
import type { JaToken } from './furigana';
import type { FromLinderaWorker, ToLinderaWorker } from './protocol';

export interface JaClient {
  /** The tokens, or null once the worker is gone. */
  tokenize(text: string): Promise<JaToken[] | null>;
  terminate(): void;
}

/** Starts the worker on the dictionary's bytes (transferred) and resolves once it can tokenize. */
export function startJaClient(wasm: ArrayBuffer): Promise<JaClient> {
  const worker = createLinderaWorker();
  const pending = new Map<number, (tokens: JaToken[] | null) => void>();
  let nextId = 1;
  const settleAll = () => {
    for (const done of pending.values()) done(null);
    pending.clear();
  };
  const client: JaClient = {
    tokenize: (text) => new Promise((done) => {
      const id = nextId++;
      pending.set(id, done);
      worker.postMessage({ type: 'tokenize', id, text } satisfies ToLinderaWorker);
    }),
    terminate: () => {
      worker.terminate();
      settleAll();
    },
  };
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FromLinderaWorker>) => {
      const msg = e.data;
      if (msg.type === 'ready') resolve(client);
      else if (msg.type === 'failed') {
        worker.terminate();
        reject(new Error(msg.message));
      } else {
        pending.get(msg.id)?.(msg.tokens);
        pending.delete(msg.id);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      worker.terminate();
      settleAll();
      reject(new Error(e.message || 'The Lindera worker stopped'));
    };
    worker.postMessage({ type: 'init', wasm } satisfies ToLinderaWorker, [wasm]);
  });
}
```

- [ ] **Step 4: Run the client test to see it pass**

Run: `npx vitest run src/lib/reading/ja/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing plugin test** — `vite.lindera-wasm-url.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { linderaWasmUrl } from './vite.lindera-wasm-url';

const GLUE_ID = '/x/node_modules/lindera-wasm-ipadic-web/lindera_wasm.js';
const transform = (code: string, id: string) =>
  (linderaWasmUrl().transform as (code: string, id: string) => { code: string } | null)(code, id);

describe('linderaWasmUrl', () => {
  it("replaces the glue's default wasm URL, so no bundler emits or inlines the 17 MB file", () => {
    const out = transform("if (x === undefined) { x = new URL('lindera_wasm_bg.wasm', import.meta.url); }", GLUE_ID);
    expect(out?.code).not.toContain('lindera_wasm_bg.wasm');
    expect(out?.code).toContain('never from the build');
  });
  it('leaves every other module alone', () => {
    expect(transform("new URL('lindera_wasm_bg.wasm', import.meta.url)", '/x/src/other.ts')).toBeNull();
  });
  it('fails the build when a new glue no longer names its wasm that way', () => {
    expect(() => transform('const u = wasmUrl();', GLUE_ID)).toThrow(/no longer names its wasm/);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run vite.lindera-wasm-url.test.ts`
Expected: FAIL, cannot resolve `./vite.lindera-wasm-url`.

- [ ] **Step 7: Write the plugin** — `vite.lindera-wasm-url.ts`

```ts
import type { Plugin } from 'vite'

const GLUE = 'lindera-wasm-ipadic-web/lindera_wasm.js'
const DEFAULT_URL = "new URL('lindera_wasm_bg.wasm', import.meta.url)"

/**
 * The Lindera glue names its 17 MB wasm (IPADIC inside) with
 * `new URL(…, import.meta.url)`, which Vite emits as an asset, or inlines in a
 * library build. The app instantiates it from bytes it downloaded once
 * (src/lib/reading/ja/dictionary.ts), so the reference is replaced with a throw.
 * Listed in `plugins` and in `worker.plugins`: the glue lives in a worker bundle.
 */
export function linderaWasmUrl(): Plugin {
  return {
    name: 'lindera-wasm-url',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').includes(GLUE)) return null
      if (!code.includes(DEFAULT_URL)) {
        throw new Error(`lindera-wasm-url: ${GLUE} no longer names its wasm as ${DEFAULT_URL}; update this plugin`)
      }
      return {
        code: code.replace(DEFAULT_URL, "(() => { throw new Error('The Lindera wasm is loaded from storage, never from the build') })()"),
        map: null,
      }
    },
  }
}
```

- [ ] **Step 8: Run the plugin test to see it pass**

Run: `npx vitest run vite.lindera-wasm-url.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the plugin into both builds**

`vite.config.ts`: add `import { linderaWasmUrl } from './vite.lindera-wasm-url'` beside the other `./vite.*` imports; add `linderaWasmUrl(),` to `plugins` right after `dropDuplicateOrtWasm(),`; change the `worker` block to:

```ts
    worker: {
      format: 'es',
      plugins: () => [linderaWasmUrl()],
      rollupOptions: {
        output: { manualChunks: workerManualChunks },
      },
    },
```

`extension/vite.config.ts`: add `import { linderaWasmUrl } from '../vite.lindera-wasm-url'`; add `linderaWasmUrl(),` to its `plugins`; give its `worker` block the same `plugins: () => [linderaWasmUrl()],` line.

- [ ] **Step 10: Write the build check** — `scripts/check-no-lindera-wasm.mjs`

```js
#!/usr/bin/env node
// Fails when a build carries the Lindera wasm (17,750,350 bytes, IPADIC inside):
// the app downloads it on first use of Japanese readings (vite.lindera-wasm-url.ts).
// Usage: node scripts/check-no-lindera-wasm.mjs build extension/dist
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LINDERA_WASM_BYTES = 17_750_350;
const INLINED_JS_BYTES = 15_000_000; // the wasm as base64 in a chunk would be ~23.7 MB

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node scripts/check-no-lindera-wasm.mjs <build dir>...');
  process.exit(2);
}
const hits = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (name.includes('lindera_wasm_bg') || st.size === LINDERA_WASM_BYTES || (/\.m?js$/.test(name) && st.size > INLINED_JS_BYTES)) {
      hits.push(`${path} (${st.size} bytes)`);
    }
  }
};
for (const dir of dirs) walk(dir);
if (hits.length > 0) {
  console.error(`The Lindera wasm is in the build:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`No Lindera wasm in ${dirs.join(', ')}`);
```

Add to `package.json` `scripts`: `"check:no-lindera-wasm": "node scripts/check-no-lindera-wasm.mjs build extension/dist"`. The real build check runs in Task B13, once the worker is reachable from the app.

- [ ] **Step 11: Commit**

```bash
git add src/lib/reading/ja/protocol.ts src/lib/reading/ja/lindera.worker.ts src/lib/reading/ja/createLinderaWorker.ts src/lib/reading/ja/client.ts src/lib/reading/ja/client.test.ts vite.lindera-wasm-url.ts vite.lindera-wasm-url.test.ts scripts/check-no-lindera-wasm.mjs vite.config.ts extension/vite.config.ts package.json
git commit -m "feat(reading): Lindera worker for Japanese, its wasm kept out of the build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B8: The Japanese runtime

**Files:**
- Create: `src/lib/reading/ja/runtime.ts`
- Test: `src/lib/reading/ja/runtime.test.ts`

**Interfaces:**
- Consumes: `storedDictionary`, `downloadDictionary`, `DICTIONARY_BYTES` (B6); `startJaClient` (B7); `reportWarning`, `describeCause`.
- Produces: `type JapaneseState = { phase: 'off' } | { phase: 'loading' } | { phase: 'downloading'; done: number; total: number } | { phase: 'ready' } | { phase: 'failed' }`; `getJapaneseState(): JapaneseState`; `subscribeJapanese(listener: () => void): () => void`; `setJapaneseWanted(wanted: boolean): void`; `retryJapanese(): void`; `tokenizeJapanese(text: string): Promise<JaToken[] | null> | null` (null when not ready).

- [ ] **Step 1: Write the failing test** — `src/lib/reading/ja/runtime.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const storedDictionary = vi.fn<() => Promise<ArrayBuffer | null>>();
const downloadDictionary = vi.fn();
const startJaClient = vi.fn();
const reportWarning = vi.fn();

vi.mock('./dictionary', () => ({ DICTIONARY_BYTES: 100, storedDictionary, downloadDictionary }));
vi.mock('./client', () => ({ startJaClient }));
vi.mock('../../diagnostics/report', () => ({ reportWarning, describeCause: (e: unknown) => String(e) }));

const runtime = await import('./runtime');
const flush = () => new Promise((r) => setTimeout(r, 0));
const fakeClient = () => ({ tokenize: vi.fn(async () => [{ surface: '雨', reading: 'アメ', unknown: false }]), terminate: vi.fn() });

describe('the Japanese runtime', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => runtime.setJapaneseWanted(false));

  it('starts from the stored dictionary without downloading', async () => {
    storedDictionary.mockResolvedValue(new ArrayBuffer(100));
    const client = fakeClient();
    startJaClient.mockResolvedValue(client);
    runtime.setJapaneseWanted(true);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'loading' });
    await flush();
    expect(downloadDictionary).not.toHaveBeenCalled();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
    expect(await runtime.tokenizeJapanese('雨')).toEqual([{ surface: '雨', reading: 'アメ', unknown: false }]);
  });

  it('downloads when nothing is stored, publishing progress', async () => {
    storedDictionary.mockResolvedValue(null);
    downloadDictionary.mockImplementation(async ({ onProgress }) => {
      onProgress(40, 100);
      expect(runtime.getJapaneseState()).toEqual({ phase: 'downloading', done: 40, total: 100 });
      return new ArrayBuffer(100);
    });
    startJaClient.mockResolvedValue(fakeClient());
    const seen: string[] = [];
    const off = runtime.subscribeJapanese(() => seen.push(runtime.getJapaneseState().phase));
    runtime.setJapaneseWanted(true);
    await flush();
    off();
    expect(seen).toEqual(['loading', 'downloading', 'downloading', 'ready']);
  });

  it('is not ready, and tokenizes nothing, before it starts', () => {
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
    expect(runtime.tokenizeJapanese('雨')).toBeNull();
  });

  it('aborts the download and stops when no longer wanted', async () => {
    storedDictionary.mockResolvedValue(null);
    let signal: AbortSignal | undefined;
    downloadDictionary.mockImplementation((opts) => { signal = opts.signal; return new Promise(() => {}); });
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    expect(signal?.aborted).toBe(true);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
  });

  it('drops a start that a stop overtook, terminating the late worker', async () => {
    storedDictionary.mockResolvedValue(new ArrayBuffer(100));
    const client = fakeClient();
    let finish!: (c: unknown) => void;
    startJaClient.mockReturnValue(new Promise((r) => { finish = r; }));
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    finish(client);
    await flush();
    expect(client.terminate).toHaveBeenCalled();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
    expect(runtime.tokenizeJapanese('雨')).toBeNull();
  });

  it('fails visibly once, and a retry starts again', async () => {
    storedDictionary.mockResolvedValue(null);
    downloadDictionary.mockRejectedValueOnce(new Error('offline'));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'failed' });
    expect(reportWarning).toHaveBeenCalledTimes(1);
    downloadDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    startJaClient.mockResolvedValue(fakeClient());
    runtime.retryJapanese();
    await flush();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
  });

  it('downloads again when the stored file is gone (local models cleared)', async () => {
    storedDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    startJaClient.mockResolvedValue(fakeClient());
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    storedDictionary.mockResolvedValueOnce(null);
    downloadDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(downloadDictionary).toHaveBeenCalledTimes(1);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
  });

  it('says nothing when an abort ends the download', async () => {
    storedDictionary.mockResolvedValue(null);
    downloadDictionary.mockRejectedValue(new DOMException('Download cancelled', 'AbortError'));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(reportWarning).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/reading/ja/runtime.test.ts`
Expected: FAIL, cannot resolve `./runtime`.

- [ ] **Step 3: Write the code** — `src/lib/reading/ja/runtime.ts`

```ts
import { describeCause, reportWarning } from '../../diagnostics/report';
import { startJaClient, type JaClient } from './client';
import { DICTIONARY_BYTES, downloadDictionary, storedDictionary } from './dictionary';
import type { JaToken } from './furigana';

/** Where Japanese readings are: off, loading the stored file or the worker, downloading, ready, or failed. */
export type JapaneseState =
  | { phase: 'off' }
  | { phase: 'loading' }
  | { phase: 'downloading'; done: number; total: number }
  | { phase: 'ready' }
  | { phase: 'failed' };

let state: JapaneseState = { phase: 'off' };
let wanted = false;
/** Bumped by every start and stop, so an overtaken start drops what it finishes. */
let generation = 0;
let controller: AbortController | null = null;
let client: JaClient | null = null;
const listeners = new Set<() => void>();

function publish(next: JapaneseState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function getJapaneseState(): JapaneseState {
  return state;
}

export function subscribeJapanese(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Starts Japanese readings (the dictionary, then the worker) or stops them, giving the worker's memory back. */
export function setJapaneseWanted(next: boolean): void {
  if (next === wanted) return;
  wanted = next;
  if (next) void start();
  else stop();
}

export function retryJapanese(): void {
  if (wanted && state.phase === 'failed') void start();
}

/** The tokens of `text`, or null when the worker is not ready. */
export function tokenizeJapanese(text: string): Promise<JaToken[] | null> | null {
  return client ? client.tokenize(text) : null;
}

function stop(): void {
  generation++;
  controller?.abort();
  controller = null;
  client?.terminate();
  client = null;
  publish({ phase: 'off' });
}

async function start(): Promise<void> {
  const gen = ++generation;
  controller?.abort();
  const own = new AbortController();
  controller = own;
  publish({ phase: 'loading' });
  try {
    // Read storage on every start: clearing local models deletes the file.
    let bytes = await storedDictionary();
    if (gen !== generation) return;
    if (!bytes) {
      publish({ phase: 'downloading', done: 0, total: DICTIONARY_BYTES });
      bytes = await downloadDictionary({
        signal: own.signal,
        onProgress: (done, total) => {
          if (gen === generation) publish({ phase: 'downloading', done, total });
        },
      });
      if (gen !== generation) return;
    }
    const started = await startJaClient(bytes);
    if (gen !== generation) {
      started.terminate();
      return;
    }
    client = started;
    publish({ phase: 'ready' });
  } catch (err) {
    if (gen !== generation || (err as Error)?.name === 'AbortError') return;
    reportWarning('Readings', `Japanese readings are unavailable: ${describeCause(err)}`, { cause: err });
    publish({ phase: 'failed' });
  }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/reading/ja/runtime.test.ts`
Expected: PASS (8 tests). If `reportWarning`'s `Message<T>` type rejects the template string, check `src/lib/diagnostics/report.ts` and pass a plain `string` variable.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reading/ja/runtime.ts src/lib/reading/ja/runtime.test.ts
git commit -m "feat(reading): Japanese runtime, from stored dictionary to worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B9: `annotate` and `useReading`

**Files:**
- Create: `src/lib/reading/annotate.ts`
- Create: `src/lib/reading/useReading.ts`
- Test: `src/lib/reading/annotate.test.ts`
- Test: `src/lib/reading/useReading.test.tsx`

**Interfaces:**
- Consumes: B1–B5 annotators; `tokenizeJapanese`, `subscribeJapanese`, `getJapaneseState` (B8); `furigana` (B5).
- Produces: `CACHE_LIMIT = 2000`; `peekReading(text: string, lang: ReadingLanguage): RubyPiece[] | null`; `requestReading(text: string, lang: ReadingLanguage): void`; `subscribeReading(text: string, lang: ReadingLanguage, listener: () => void): () => void`; `holdLastReading(pieces: RubyPiece[]): RubyPiece[]`; `useReading(text: string, lang: ReadingLanguage | null, holdTail: boolean): RubyPiece[] | null`.

- [ ] **Step 1: Write the failing test** — `src/lib/reading/annotate.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const japanese = {
  state: { phase: 'off' } as { phase: string },
  listeners: new Set<() => void>(),
  tokenize: vi.fn<(text: string) => Promise<unknown> | null>(),
};
vi.mock('./ja/runtime', () => ({
  getJapaneseState: () => japanese.state,
  subscribeJapanese: (l: () => void) => { japanese.listeners.add(l); return () => japanese.listeners.delete(l); },
  tokenizeJapanese: (text: string) => japanese.tokenize(text),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));
let annotate: typeof import('./annotate');

beforeEach(async () => {
  vi.resetModules();
  japanese.state = { phase: 'off' };
  japanese.listeners.clear();
  japanese.tokenize.mockReset();
  annotate = await import('./annotate');
});

describe('annotate', () => {
  it('has nothing before an annotator loads, then the pieces, telling the waiting row', async () => {
    expect(annotate.peekReading('같이', 'ko')).toBeNull();
    const listener = vi.fn();
    annotate.subscribeReading('같이', 'ko', listener);
    annotate.requestReading('같이', 'ko');
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(annotate.peekReading('같이', 'ko')).toEqual([{ text: '같이', reading: 'gachi' }]);
  });

  it('returns the same pieces for the same text, so React sees no change', async () => {
    annotate.requestReading('一下', 'zh');
    await vi.waitFor(() => expect(annotate.peekReading('一下', 'zh')).not.toBeNull());
    expect(annotate.peekReading('一下', 'zh')).toBe(annotate.peekReading('一下', 'zh'));
  });

  it('evicts the least recently used past the limit, keeping what was just read', async () => {
    annotate.requestReading('да', 'ru');
    await vi.waitFor(() => expect(annotate.peekReading('да', 'ru')).not.toBeNull());
    const first = annotate.peekReading('слово0', 'ru');
    for (let k = 1; k < annotate.CACHE_LIMIT; k++) annotate.peekReading(`слово${k}`, 'ru');
    const kept = annotate.peekReading('да', 'ru'); // read again: now the newest
    for (let k = 0; k < annotate.CACHE_LIMIT - 1; k++) annotate.peekReading(`ещё${k}`, 'ru');
    expect(annotate.peekReading('да', 'ru')).toBe(kept);
    expect(annotate.peekReading('слово0', 'ru')).not.toBe(first);
  });

  it('asks the Japanese worker once per text and tells that row', async () => {
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockResolvedValue([{ surface: '雨', reading: 'アメ', unknown: false }]);
    const listener = vi.fn();
    annotate.subscribeReading('雨', 'ja', listener);
    annotate.requestReading('雨', 'ja');
    annotate.requestReading('雨', 'ja');
    await flush();
    expect(japanese.tokenize).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    expect(annotate.peekReading('雨', 'ja')).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  it('asks again for the Japanese rows that waited, once the worker is ready', async () => {
    japanese.tokenize.mockReturnValue(null);
    annotate.requestReading('雨', 'ja');
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockResolvedValue([{ surface: '雨', reading: 'アメ', unknown: false }]);
    japanese.listeners.forEach((l) => l());
    await flush();
    expect(annotate.peekReading('雨', 'ja')).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  it('keeps nothing from a worker that went away', async () => {
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockResolvedValue(null);
    annotate.requestReading('雨', 'ja');
    await flush();
    expect(annotate.peekReading('雨', 'ja')).toBeNull();
  });
});

describe('holdLastReading', () => {
  it('drops the reading of the last annotated piece only', async () => {
    const { holdLastReading } = annotate;
    expect(holdLastReading([{ text: '今日', reading: 'きょう' }, { text: 'は' }, { text: '明', reading: 'あきら' }, { text: '。' }]))
      .toEqual([{ text: '今日', reading: 'きょう' }, { text: 'は' }, { text: '明' }, { text: '。' }]);
    expect(holdLastReading([{ text: 'abc' }])).toEqual([{ text: 'abc' }]);
  });
});
```


- [ ] **Step 2: Write the failing hook test** — `src/lib/reading/useReading.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let pieces: unknown = null;
const listeners = new Set<() => void>();
const requestReading = vi.fn();
vi.mock('./annotate', () => ({
  peekReading: () => pieces,
  requestReading: (...args: unknown[]) => requestReading(...args),
  subscribeReading: (_t: string, _l: string, listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  holdLastReading: (ps: { text: string; reading?: string }[]) => ps.map((p, i) => (i === ps.length - 1 ? { text: p.text } : p)),
}));
const { useReading } = await import('./useReading');

describe('useReading', () => {
  it('asks for what it lacks, then shows it when told', () => {
    pieces = null;
    const { result } = renderHook(() => useReading('雨', 'ja', false));
    expect(result.current).toBeNull();
    expect(requestReading).toHaveBeenCalledWith('雨', 'ja');
    pieces = [{ text: '雨', reading: 'あめ' }];
    act(() => listeners.forEach((l) => l()));
    expect(result.current).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  it('holds back the last reading when asked', () => {
    pieces = [{ text: '雨', reading: 'あめ' }];
    const { result } = renderHook(() => useReading('雨', 'ja', true));
    expect(result.current).toEqual([{ text: '雨' }]);
  });

  it('is null and asks for nothing without a language', () => {
    requestReading.mockClear();
    const { result } = renderHook(() => useReading('rain', null, false));
    expect(result.current).toBeNull();
    expect(requestReading).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npx vitest run src/lib/reading/annotate.test.ts src/lib/reading/useReading.test.tsx`
Expected: FAIL, cannot resolve `./annotate` / `./useReading`.

- [ ] **Step 4: Write `annotate.ts`**

```ts
import { describeCause, reportWarning } from '../diagnostics/report';
import { furigana } from './ja/furigana';
import { getJapaneseState, subscribeJapanese, tokenizeJapanese } from './ja/runtime';
import type { ReadingLanguage, RubyPiece } from './types';

type SyncLanguage = Exclude<ReadingLanguage, 'ja'>;
type Annotator = (text: string) => RubyPiece[];

// Each annotator loads the first time its language is asked for, so none of this
// is in the startup bundle; once loaded it runs synchronously in render.
const LOADERS: Record<SyncLanguage, () => Promise<Annotator>> = {
  zh: () => import('./zh').then((m) => m.annotateChinese),
  ko: () => import('./ko').then((m) => m.annotateKorean),
  ru: () => import('./cyrillic').then((m) => (text: string) => m.annotateCyrillic(text, 'ru')),
  uk: () => import('./cyrillic').then((m) => (text: string) => m.annotateCyrillic(text, 'uk')),
};

export const CACHE_LIMIT = 2000;
const WAITING_LIMIT = 500;

const annotators = new Map<SyncLanguage, Annotator>();
const loading = new Set<SyncLanguage>();
/** Pieces by language and text, least recently used first. Rows churn while streaming. */
const cache = new Map<string, RubyPiece[]>();
/** Japanese texts sent to the worker and not yet answered. */
const asked = new Set<string>();
/** Japanese texts asked for before the worker was ready. */
const waiting = new Map<string, string>();
const byKey = new Map<string, Set<() => void>>();
const everyone = new Set<() => void>();

const keyOf = (text: string, lang: ReadingLanguage) => `${lang}\u0000${text}`;

function remember(key: string, pieces: RubyPiece[]): RubyPiece[] {
  cache.delete(key);
  cache.set(key, pieces);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return pieces;
}

function tell(listeners: Iterable<() => void> | undefined): void {
  if (listeners) for (const listener of [...listeners]) listener();
}

/** The pieces for `text`, or null while its annotator is not ready. Starts nothing (see `requestReading`). */
export function peekReading(text: string, lang: ReadingLanguage): RubyPiece[] | null {
  const key = keyOf(text, lang);
  const hit = cache.get(key);
  if (hit) return remember(key, hit);
  if (lang === 'ja') return null;
  const annotator = annotators.get(lang);
  return annotator ? remember(key, annotator(text)) : null;
}

/** Starts what `peekReading` is waiting on: loading an annotator, or tokenizing Japanese. */
export function requestReading(text: string, lang: ReadingLanguage): void {
  if (lang !== 'ja') {
    if (annotators.has(lang) || loading.has(lang)) return;
    loading.add(lang);
    LOADERS[lang]().then(
      (annotator) => {
        annotators.set(lang, annotator);
        loading.delete(lang);
        tell(everyone);
      },
      (err) => {
        loading.delete(lang);
        reportWarning('Readings', `The ${lang} readings could not load: ${describeCause(err)}`, { cause: err });
      },
    );
    return;
  }
  const key = keyOf(text, 'ja');
  if (cache.has(key) || asked.has(key)) return;
  const pending = tokenizeJapanese(text);
  if (!pending) {
    waiting.delete(key);
    waiting.set(key, text);
    if (waiting.size > WAITING_LIMIT) waiting.delete(waiting.keys().next().value as string);
    return;
  }
  asked.add(key);
  void pending.then((tokens) => {
    asked.delete(key);
    if (!tokens) return;
    remember(key, furigana(tokens));
    tell(byKey.get(key));
  });
}

/** Tells `listener` when the pieces for `text` arrive or its annotator loads. */
export function subscribeReading(text: string, lang: ReadingLanguage, listener: () => void): () => void {
  const key = keyOf(text, lang);
  let listeners = byKey.get(key);
  if (!listeners) byKey.set(key, (listeners = new Set()));
  listeners.add(listener);
  everyone.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) byKey.delete(key);
    everyone.delete(listener);
  };
}

/** The pieces with the last reading dropped: a growing row's last word may still change (R11). */
export function holdLastReading(pieces: RubyPiece[]): RubyPiece[] {
  let last = -1;
  pieces.forEach((p, i) => { if (p.reading !== undefined) last = i; });
  if (last < 0) return pieces;
  return pieces.map((p, i) => (i === last ? { text: p.text } : p));
}

subscribeJapanese(() => {
  const phase = getJapaneseState().phase;
  if (phase === 'off') {
    waiting.clear();
    return;
  }
  if (phase !== 'ready') return;
  const texts = [...waiting.values()];
  waiting.clear();
  for (const text of texts) requestReading(text, 'ja');
});
```

- [ ] **Step 5: Write `useReading.ts`**

```ts
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { holdLastReading, peekReading, requestReading, subscribeReading } from './annotate';
import type { ReadingLanguage, RubyPiece } from './types';

const noSubscription = () => () => {};

/** A row's ruby pieces, or null while they are not ready or the row gets no readings. */
export function useReading(text: string, lang: ReadingLanguage | null, holdTail: boolean): RubyPiece[] | null {
  const subscribe = useCallback(
    (listener: () => void) => (lang ? subscribeReading(text, lang, listener) : noSubscription()),
    [text, lang],
  );
  const pieces = useSyncExternalStore(subscribe, () => (lang ? peekReading(text, lang) : null));
  useEffect(() => {
    if (lang && !pieces) requestReading(text, lang);
  }, [text, lang, pieces]);
  return useMemo(() => (pieces && holdTail ? holdLastReading(pieces) : pieces), [pieces, holdTail]);
}
```

- [ ] **Step 6: Run both tests to see them pass**

Run: `npx vitest run src/lib/reading/annotate.test.ts src/lib/reading/useReading.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reading/annotate.ts src/lib/reading/useReading.ts src/lib/reading/annotate.test.ts src/lib/reading/useReading.test.tsx
git commit -m "feat(reading): annotate with a bounded cache, and the row hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B10: The two switches, the current target, and the Japanese binder

**Files:**
- Modify: `src/stores/conversationDisplayStore.ts`, `src/stores/subtitleStore.ts`
- Test: `src/stores/conversationDisplayStore.test.ts` (add cases), `src/stores/subtitleStore.readings.test.ts` (new)
- Create: `src/lib/reading/useReadingTargets.ts`
- Test: `src/lib/reading/useReadingTargets.test.tsx`
- Create: `src/app/readings.ts`
- Test: `src/app/readings.test.ts`
- Modify: `src/routes/Home.tsx`

**Interfaces:**
- Consumes: `readingTargets` (B1); `setJapaneseWanted` (B8).
- Produces: `showReadings`/`setShowReadings` on both stores; hooks `useConversationDisplayShowReadings`, `useSetConversationDisplayShowReadings`, `useSubtitleShowReadings`, `useSetSubtitleShowReadings`; `currentReadingTarget(): string | null` and `useReadingTargets(): ReadonlySet<ReadingLanguage>` (`src/lib/reading/useReadingTargets.ts`); `bindReadings(): () => void` (`src/app/readings.ts`).

- [ ] **Step 1: Write the failing store tests**

Append to `src/stores/conversationDisplayStore.test.ts`, inside the existing `describe`:

```ts
  it('has readings off by default and persists the switch under the conversationDisplay namespace', async () => {
    useConversationDisplayStore.setState({ showReadings: false } as never);
    expect(useConversationDisplayStore.getState().showReadings).toBe(false);
    await useConversationDisplayStore.getState().setShowReadings(true);
    expect(useConversationDisplayStore.getState().showReadings).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith('settings.common.conversationDisplay.showReadings', true);
  });

  it('hydrates showReadings', async () => {
    mockGetSetting.mockImplementation(async (key: string, def: unknown) => (key.endsWith('showReadings') ? true : def));
    await useConversationDisplayStore.getState().hydrate();
    expect(useConversationDisplayStore.getState().showReadings).toBe(true);
    mockGetSetting.mockImplementation(async (_key: string, def: unknown) => def);
  });
```

Create `src/stores/subtitleStore.readings.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const setSetting = vi.fn(async () => ({ success: true }));
const getSetting = vi.fn(async (key: string, def: unknown) => (key.endsWith('showReadings') ? true : def));
vi.mock('../services/ServiceFactory', () => ({ ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) } }));

const { useSubtitleStore } = await import('./subtitleStore');

describe('subtitleStore readings switch', () => {
  it('is off by default, persists under settings.common.subtitle, and hydrates', async () => {
    expect(useSubtitleStore.getState().showReadings).toBe(false);
    await useSubtitleStore.getState().setShowReadings(true);
    expect(setSetting).toHaveBeenCalledWith('settings.common.subtitle.showReadings', true);
    useSubtitleStore.setState({ showReadings: false } as never);
    await useSubtitleStore.getState().hydrate();
    expect(useSubtitleStore.getState().showReadings).toBe(true);
  });
});
```

Before relying on the `setSetting` call shape, read `src/services/persistSetting.ts` and the existing "persists each setter" test in `conversationDisplayStore.test.ts`; assert the same argument shape it does.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/stores/conversationDisplayStore.test.ts src/stores/subtitleStore.readings.test.ts`
Expected: FAIL, `setShowReadings is not a function`.

- [ ] **Step 3: Add the field to both stores**

`src/stores/conversationDisplayStore.ts`:
- interface: `showReadings: boolean;` after `compactMode`, and `setShowReadings: (b: boolean) => Promise<void>;` after `setCompactMode`;
- `DEFAULTS`: `showReadings: false,`;
- setter, after `setCompactMode`:

```ts
    setShowReadings: async (b) => {
      const previous = get().showReadings;
      set({ showReadings: b });
      const { ok } = await persist('showReadings', b);
      if (!ok) set({ showReadings: previous });
    },
```

- `hydrate`: read `svc.getSetting(KEY('showReadings'), DEFAULTS.showReadings)` as a sixth entry of the `Promise.all` and `set` it;
- hooks:

```ts
export const useConversationDisplayShowReadings = () => useConversationDisplayStore((s) => s.showReadings);
export const useSetConversationDisplayShowReadings = () => useConversationDisplayStore((s) => s.setShowReadings);
```

`src/stores/subtitleStore.ts`: the same four changes (`showReadings: boolean` in the state after `newItemHighlightEnabled`, `setShowReadings` after `setNewItemHighlightEnabled`, `DEFAULTS.showReadings: false`, a setter shaped like `setNewItemHighlightEnabled`'s, a thirteenth `getSetting` in `hydrate`), and:

```ts
export const useSubtitleShowReadings = () => useSubtitleStore((s) => s.showReadings);
export const useSetSubtitleShowReadings = () => useSubtitleStore((s) => s.setShowReadings);
```

- [ ] **Step 4: Run the store tests to see them pass**

Run: `npx vitest run src/stores/conversationDisplayStore.test.ts src/stores/subtitleStore.readings.test.ts src/stores/subtitleStore`
Expected: PASS, and every existing subtitle store test still passes.

- [ ] **Step 5: Write the failing targets and binder tests**

`src/lib/reading/useReadingTargets.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProviderStore } from '../../stores/providerStore';
import { currentReadingTarget, useReadingTargets } from './useReadingTargets';

const choose = (target: string | null) => useProviderStore.setState({
  selected: target ? 'soniox' : null,
  entries: target ? { soniox: { pair: { source: 'zh', target } } } : {},
} as never);

describe('the current reading target', () => {
  it("is the selected provider's pair target, and its reading languages", () => {
    choose('ja');
    expect(currentReadingTarget()).toBe('ja');
    const { result } = renderHook(() => useReadingTargets());
    expect([...result.current]).toEqual(['ja']);
    act(() => choose('zh+en'));
    expect([...result.current]).toEqual(['zh']);
    act(() => choose(null));
    expect(result.current.size).toBe(0);
  });
});
```

`src/app/readings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setJapaneseWanted = vi.fn();
vi.mock('../lib/reading/ja/runtime', () => ({ setJapaneseWanted }));
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

const { useConversationDisplayStore } = await import('../stores/conversationDisplayStore');
const { useSubtitleStore } = await import('../stores/subtitleStore');
const { useProviderStore } = await import('../stores/providerStore');
const { bindReadings } = await import('./readings');

const choose = (target: string) => useProviderStore.setState({ selected: 'soniox', entries: { soniox: { pair: { source: 'zh', target } } } } as never);

describe('bindReadings', () => {
  beforeEach(() => {
    setJapaneseWanted.mockClear();
    useConversationDisplayStore.setState({ showReadings: false } as never);
    useSubtitleStore.setState({ showReadings: false } as never);
    choose('ja');
  });

  it('wants Japanese while either switch is on and the target is Japanese', () => {
    const unbind = bindReadings();
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(false);
    useSubtitleStore.setState({ showReadings: true } as never);
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(true);
    unbind();
  });

  it('tells the runtime when Japanese stops being wanted: the pair moved to Korean', () => {
    useConversationDisplayStore.setState({ showReadings: true } as never);
    const unbind = bindReadings();
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(true);
    choose('ko');
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(false);
    unbind();
  });

  it('stops Japanese when unbound', () => {
    useConversationDisplayStore.setState({ showReadings: true } as never);
    const unbind = bindReadings();
    unbind();
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(false);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx vitest run src/lib/reading/useReadingTargets.test.tsx src/app/readings.test.ts`
Expected: FAIL, cannot resolve the modules.

- [ ] **Step 7: Write the hook and the binder**

`src/lib/reading/useReadingTargets.ts`:

```ts
import { useMemo } from 'react';
import { useProviderStore } from '../../stores/providerStore';
import { readingTargets } from './languages';
import type { ReadingLanguage } from './types';

/** The selected provider's pair target, as the surfaces show it (the `sharedPair` rule in app/captionShare.ts). */
export function currentReadingTarget(): string | null {
  const providers = useProviderStore.getState();
  const id = providers.selected;
  return id ? providers.entries[id]?.pair?.target ?? null : null;
}

/** The reading languages the switch names and annotates (R3, R13). */
export function useReadingTargets(): ReadonlySet<ReadingLanguage> {
  const target = useProviderStore((s) => (s.selected ? s.entries[s.selected]?.pair?.target ?? null : null));
  return useMemo(() => readingTargets(target), [target]);
}
```

`src/app/readings.ts`:

```ts
import { readingTargets } from '../lib/reading/languages';
import { setJapaneseWanted } from '../lib/reading/ja/runtime';
import { currentReadingTarget } from '../lib/reading/useReadingTargets';
import { useConversationDisplayStore } from '../stores/conversationDisplayStore';
import { useProviderStore } from '../stores/providerStore';
import { useSubtitleStore } from '../stores/subtitleStore';

/**
 * Keeps the Japanese runtime (dictionary and worker) running exactly while a
 * surface's readings switch is on and the target includes Japanese (spec §3).
 * Started once by Home; the extension overlay never starts it.
 */
export function bindReadings(): () => void {
  const sync = () => {
    const on = useConversationDisplayStore.getState().showReadings || useSubtitleStore.getState().showReadings;
    setJapaneseWanted(on && readingTargets(currentReadingTarget()).has('ja'));
  };
  sync();
  const unsubscribes = [
    useConversationDisplayStore.subscribe(sync),
    useSubtitleStore.subscribe(sync),
    useProviderStore.subscribe(sync),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    setJapaneseWanted(false);
  };
}
```

- [ ] **Step 8: Start the binder in Home**

In `src/routes/Home.tsx`, import `bindReadings` from `'../app/readings'` and change the effect's end from `return watchDevices({ … });` to:

```tsx
    const unbindReadings = bindReadings();
    const stopWatching = watchDevices({
      // …the existing object, unchanged…
    });
    return () => {
      stopWatching();
      unbindReadings();
    };
```

- [ ] **Step 9: Run the tests to see them pass**

Run: `npx vitest run src/lib/reading/useReadingTargets.test.tsx src/app/readings.test.ts src/routes`
Expected: PASS. If `useProviderStore.setState` needs more fields for its selectors, copy the minimal state shape from `src/app/captionSharePair.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add src/stores/conversationDisplayStore.ts src/stores/conversationDisplayStore.test.ts src/stores/subtitleStore.ts src/stores/subtitleStore.readings.test.ts src/lib/reading/useReadingTargets.ts src/lib/reading/useReadingTargets.test.tsx src/app/readings.ts src/app/readings.test.ts src/routes/Home.tsx
git commit -m "feat(reading): a readings switch per surface, and the Japanese binder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B11: Drawing the ruby

**Files:**
- Modify: `src/components/Conversation/ConversationList.tsx`
- Test: `src/components/Conversation/ConversationList.readings.test.tsx`
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/components/Subtitle/SubtitleBands.tsx`, `src/components/Subtitle/SubtitleView.tsx`
- Modify: `src/components/MainPanel/ConversationRow.scss`
- Modify: `docs/superpowers/specs/2026-10-15-pronunciation-ruby-design.md` (§4, the prop's shape)

**Interfaces:**
- Consumes: `useReading` (B9); `readingLanguage` (B1); `useReadingTargets` (B10); `useConversationDisplayShowReadings`, `useSubtitleShowReadings` (B10).
- Produces: `ConversationListProps.readings?: ReadonlySet<ReadingLanguage>` (absent or empty: no readings); `SubtitleBodyProps.readings?` (same).

- [ ] **Step 1: Write the failing test** — `src/components/Conversation/ConversationList.readings.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { Row } from '../../lib/projection/types';
import type { DisplayItem } from '../../lib/view/filter';
import type { ReadingLanguage, RubyPiece } from '../../lib/reading/types';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

const calls: { text: string; lang: ReadingLanguage | null; holdTail: boolean }[] = [];
let answer: (text: string) => RubyPiece[] | null = () => null;
vi.mock('../../lib/reading/useReading', () => ({
  useReading: (text: string, lang: ReadingLanguage | null, holdTail: boolean) => {
    calls.push({ text, lang, holdTail });
    return lang ? answer(text) : null;
  },
}));

const { ConversationList } = await import('./ConversationList');

const row = (over: Partial<Row> = {}): Row => ({ key: 'k', segmentId: 's:speaker:1', side: 'translation', start: 0, end: 4, text: '今日は雨', final: true, ...over });
const item = (over: Partial<Extract<DisplayItem, { kind: 'row' }>> = {}): DisplayItem => ({
  kind: 'row', row: row(), leg: 'speaker', languages: { source: 'zh', target: 'ja' }, t: 0, header: true, endsSegment: true, ...over,
});
const list = (items: DisplayItem[], readings?: ReadonlySet<ReadingLanguage>, lit = new Map()) => render(
  <ConversationList items={items} lit={lit} replaying={null} replayLegs={new Set()} canReplay={() => false} onReplay={() => {}} compact={false} fontSize={14} empty={null} readings={readings} />,
);
const JA: ReadonlySet<ReadingLanguage> = new Set(['ja']);

describe('ConversationList readings', () => {
  beforeEach(() => { calls.length = 0; answer = () => [{ text: '今日', reading: 'きょう' }, { text: 'は' }, { text: '雨', reading: 'あめ' }]; });

  it('draws ruby with hidden readings on a row in the target language', () => {
    const { container } = list([item()], JA);
    const rubies = container.querySelectorAll('.row-text ruby');
    expect(rubies).toHaveLength(2);
    expect(rubies[0].querySelector('rt')?.textContent).toBe('きょう');
    expect(rubies[0].querySelector('rt')?.getAttribute('aria-hidden')).toBe('true');
  });

  it("annotates the other side's original too, and not my source", () => {
    list([
      item({ row: row({ key: 'k1', side: 'source', text: '我们走吧' }), languages: { source: 'zh', target: 'ja' } }),
      item({ leg: 'participant', row: row({ key: 'k2', segmentId: 's:participant:1', side: 'source', text: '雨です' }), languages: { source: 'ja', target: 'zh' } }),
    ], JA);
    expect(calls.find((c) => c.text === '我们走吧')?.lang).toBeNull();
    expect(calls.find((c) => c.text === '雨です')?.lang).toBe('ja');
  });

  it("takes the row's detected language over the leg (face-to-face code-switching)", () => {
    list([item({ row: row({ language: 'zh', text: '好的' }) })], JA);
    expect(calls[0].lang).toBeNull();
  });

  it("draws today's markup with the switch off", () => {
    const { container } = list([item()]);
    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('.row-text')?.textContent).toBe('今日は雨');
  });

  it('holds the tail only on an unfinished row that ends its segment', () => {
    list([item({ row: row({ final: false }), endsSegment: true }), item({ row: row({ key: 'k2', final: false }), endsSegment: false })], JA);
    expect(calls.map((c) => c.holdTail)).toEqual([true, false]);
  });

  it('re-annotates when a final row\'s text changes (punctuation fill-in)', () => {
    const { rerender } = list([item()], JA);
    rerender(<ConversationList items={[item({ row: row({ text: '今日は雨。', end: 5 }) })]} lit={new Map()} replaying={null} replayLegs={new Set()} canReplay={() => false} onReplay={() => {}} compact={false} fontSize={14} empty={null} readings={JA} />);
    expect(calls.at(-1)?.text).toBe('今日は雨。');
  });

  it('karaoke over pieces: plain text splits at the offset, a ruby piece counts once wholly played', () => {
    const { container } = list([item()], JA, new Map([['s:speaker:1', 3]]));
    const played = [...container.querySelectorAll('.karaoke-played')].map((n) => n.textContent).join('');
    expect(played).toBe('今日きょうは');
  });

  it('karaoke over pieces keeps a surrogate pair whole', () => {
    answer = () => [{ text: '𠮷' }, { text: '雨', reading: 'あめ' }];
    const { container } = list([item({ row: row({ text: '𠮷雨', end: 3 }) })], JA, new Map([['s:speaker:1', 1]]));
    expect(container.querySelector('.row-text')?.textContent).toBe('𠮷雨あめ');
    expect(container.querySelector('.karaoke-played')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/Conversation/ConversationList.readings.test.tsx`
Expected: FAIL (no `readings` prop, no ruby).

- [ ] **Step 3: Change `ConversationList.tsx`**

Imports:

```tsx
import { Fragment } from 'react';
import { readingLanguage } from '../../lib/reading/languages';
import type { ReadingLanguage, RubyPiece } from '../../lib/reading/types';
import { useReading } from '../../lib/reading/useReading';
```

(`Fragment` joins the existing `react` import.)

Props — add to `ConversationListProps`:

```tsx
  /** The reading languages to annotate (spec 2026-10-15 §1); absent or empty, none. */
  readings?: ReadonlySet<ReadingLanguage>;
```

In `ConversationList`, take `readings` from props and, inside the row branch, before `return <RowBubble …>`:

```tsx
              const rowLanguage = item.row.language || (item.row.side === 'translation' ? item.languages.target : item.languages.source);
              const rowReading = readings && readings.size > 0 ? readingLanguage(rowLanguage) : null;
              const readingLang = rowReading && readings!.has(rowReading) ? rowReading : null;
```

and pass `readingLang={readingLang}` and `holdTail={!item.row.final && item.endsSegment}` to `RowBubble`.

`RowBubbleProps` gains:

```tsx
  /** The row's reading language when it gets readings, else null. */
  readingLang: ReadingLanguage | null;
  /** The row is still growing: the last reading may change (R11). */
  holdTail: boolean;
```

In `RowBubble`, after `played` is computed:

```tsx
  const pieces = useReading(text, readingLang, holdTail);
```

and replace the body of `<span className={`row-text …`}>` with:

```tsx
          {pieces ? (
            <RubyText pieces={pieces} played={played} />
          ) : played <= 0 ? (
            <span>{text}</span>
          ) : played >= text.length ? (
            <span className="karaoke-played">{text}</span>
          ) : (
            <>
              <span className="karaoke-played">{text.slice(0, played)}</span>
              <span>{text.slice(played)}</span>
            </>
          )}
```

Add below `RowBubble`:

```tsx
/**
 * The row's text as ruby pieces (spec 2026-10-15 §4). Karaoke: plain text splits
 * at the played offset; a piece with a reading counts as played once wholly
 * spoken, so a reading is never cut. Offsets are UTF-16, as `played` is.
 */
function RubyText({ pieces, played }: { pieces: RubyPiece[]; played: number }) {
  let offset = 0;
  return (
    <>
      {pieces.map((piece, i) => {
        const start = offset;
        const end = (offset += piece.text.length);
        if (piece.reading === undefined) {
          if (played <= start) return <Fragment key={i}>{piece.text}</Fragment>;
          if (played >= end) return <span key={i} className="karaoke-played">{piece.text}</span>;
          let cut = played - start;
          // Never between the halves of a surrogate pair.
          if (cut > 0 && cut < piece.text.length && /[\udc00-\udfff]/.test(piece.text[cut])) cut -= 1;
          return (
            <Fragment key={i}>
              {cut > 0 && <span className="karaoke-played">{piece.text.slice(0, cut)}</span>}
              {piece.text.slice(cut)}
            </Fragment>
          );
        }
        const ruby = <ruby>{piece.text}<rt aria-hidden="true">{piece.reading}</rt></ruby>;
        return played >= end ? <span key={i} className="karaoke-played">{ruby}</span> : <Fragment key={i}>{ruby}</Fragment>;
      })}
    </>
  );
}
```

- [ ] **Step 4: Run the new and the existing list tests**

Run: `npx vitest run src/components/Conversation`
Expected: PASS, the existing `ConversationList.test.tsx` and `ConversationList.memo.test.tsx` unchanged.

- [ ] **Step 5: Wire the surfaces**

`src/components/MainPanel/MainPanel.tsx`: import `useConversationDisplayShowReadings` (from `'../../stores/conversationDisplayStore'`) and `useReadingTargets` (from `'../../lib/reading/useReadingTargets'`); near the other display reads:

```tsx
  const showReadings = useConversationDisplayShowReadings();
  const readingTargets = useReadingTargets();
```

and pass `readings={showReadings ? readingTargets : undefined}` to `<ConversationList …>`.

`src/components/Subtitle/SubtitleBands.tsx`: add to `SubtitleBodyProps`:

```tsx
  /** The reading languages to annotate in the expanded list; the bands never draw readings (spec R6). */
  readings?: ReadonlySet<ReadingLanguage>;
```

(import the type from `'../../lib/reading/types'`), take `readings` in `SubtitleBody`, and pass `readings={readings}` to its `<ConversationList …>`.

`src/components/Subtitle/SubtitleView.tsx`: import `useSubtitleShowReadings` and `useReadingTargets`; read them beside `useSubtitleSettings()`; pass to `<SubtitleBody …>`:

```tsx
            readings={surface === 'electron' && showReadings ? readingTargets : undefined}
```

- [ ] **Step 6: Style the ruby** — append to `src/components/MainPanel/ConversationRow.scss`

```scss
// Readings (#545, spec 2026-10-15 R9): ruby over the other side's language, never
// below 10px, the text's own colour dimmed; never selected or copied with the text.
.row-text {
  ruby {
    ruby-position: over;
  }

  rt {
    font-size: max(50%, 10px);
    opacity: 0.72;
    font-style: normal;
    line-height: 1;
    letter-spacing: 0;
    user-select: none;
  }
}
```

Check it compiles: `./node_modules/.bin/sass --no-source-map --load-path=src/styles src/components/MainPanel/ConversationRow.scss > /dev/null`.

- [ ] **Step 7: Align the spec's wording with the prop**

In the spec's §4, replace "`ConversationList` takes `readings: boolean`." with "`ConversationList` takes `readings`, the reading languages to annotate (absent or empty: none)."

- [ ] **Step 8: Run the touched suites**

Run: `npx vitest run src/components/Conversation src/components/MainPanel src/components/Subtitle`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/Conversation/ConversationList.tsx src/components/Conversation/ConversationList.readings.test.tsx src/components/MainPanel/MainPanel.tsx src/components/Subtitle/SubtitleBands.tsx src/components/Subtitle/SubtitleView.tsx src/components/MainPanel/ConversationRow.scss docs/superpowers/specs/2026-10-15-pronunciation-ruby-design.md
git commit -m "feat(reading): draw readings as ruby in the panel and the subtitle view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B12: The switch in the display popover, its strings and its event

**Files:**
- Modify: `src/components/Display/DisplaySettingsPopover.tsx`, `src/components/Display/DisplaySettingsPopover.scss`
- Test: `src/components/Display/DisplaySettingsPopover.readings.test.tsx`
- Modify: `src/components/Subtitle/SubtitleBar.tsx` (two `<DisplaySettingsPopover source="subtitle" />` sites)
- Modify: `src/lib/analytics.ts`
- Modify: `src/locales/*/translation.json` (30 catalogs)

**Interfaces:**
- Consumes: `useReadingTargets` (B10); `READING_SCHEME` (B1); `getJapaneseState`, `subscribeJapanese`, `retryJapanese`, `JapaneseState` (B8); store hooks (B10); `useLanguageLabel` (`src/lib/language/useLanguageLabel.ts`); `formatBytes` (`src/lib/local-inference/formatBytes.ts`); `useAnalytics` (`src/lib/analytics.ts`); `ToggleSwitch`, `Button` (`src/components/Settings/shared/`).
- Produces: `DisplaySettingsPopoverProps.readingsOffered?: boolean` (conversation: true when absent; subtitle: false when absent); analytics event `readings_changed`.

- [ ] **Step 1: Add the strings to `en`**

In `src/locales/en/translation.json`, inside `subtitle.settings`, after `"newItemHighlight"`:

```json
      "readings": "Show {{language}} readings ({{scheme}})",
      "readingScheme": {
        "kana": "kana",
        "pinyin": "pinyin",
        "rr": "romanization",
        "latin": "Latin letters"
      },
      "readingsDownloading": "Downloading the Japanese dictionary {{done}} / {{total}}",
      "readingsDownloadFailed": "Couldn't download the Japanese dictionary."
```

Retry reuses `common.retry`.

- [ ] **Step 2: Write the failing test** — `src/components/Display/DisplaySettingsPopover.readings.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { ReadingLanguage } from '../../lib/reading/types';

// A keyed t: proves the label's keys are read (the suites cannot see localisation otherwise).
const CATALOG: Record<string, string> = {
  'subtitle.settings.readings': 'R[{{language}}|{{scheme}}]',
  'subtitle.settings.readingScheme.kana': 'KANA',
  'subtitle.settings.readingScheme.pinyin': 'PINYIN',
  'subtitle.settings.readingsDownloading': 'DL {{done}}/{{total}}',
  'subtitle.settings.readingsDownloadFailed': 'DL FAILED',
  'common.retry': 'AGAIN',
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      const vars = typeof opts === 'object' ? opts : {};
      const template = CATALOG[key] ?? (typeof opts === 'string' ? opts : (vars.defaultValue as string) ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name]));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
let targets: ReadonlySet<ReadingLanguage> = new Set(['ja']);
vi.mock('../../lib/reading/useReadingTargets', () => ({ useReadingTargets: () => targets }));
vi.mock('../../lib/language/useLanguageLabel', () => ({ useLanguageLabel: () => (code: string) => `L(${code})` }));
const trackEvent = vi.fn();
vi.mock('../../lib/analytics', async (importOriginal) => ({ ...(await importOriginal<object>()), useAnalytics: () => ({ trackEvent }) }));
let japanese: { phase: string; done?: number; total?: number } = { phase: 'off' };
const retryJapanese = vi.fn();
vi.mock('../../lib/reading/ja/runtime', () => ({
  getJapaneseState: () => japanese,
  subscribeJapanese: () => () => {},
  retryJapanese: () => retryJapanese(),
}));

const { default: DisplaySettingsPopover } = await import('./DisplaySettingsPopover');
const { useConversationDisplayStore } = await import('../../stores/conversationDisplayStore');
const { useSubtitleStore } = await import('../../stores/subtitleStore');

describe('the readings row', () => {
  beforeEach(() => {
    targets = new Set(['ja']);
    japanese = { phase: 'off' };
    trackEvent.mockClear();
    useConversationDisplayStore.setState({ showReadings: false } as never);
    useSubtitleStore.setState({ showReadings: false } as never);
  });

  it('names the language and scheme through their keys', () => {
    const { getByText } = render(<DisplaySettingsPopover source="conversation" />);
    expect(getByText('R[L(ja)|KANA]')).toBeTruthy();
  });

  it("names Chinese for a zh+en target's reading language", () => {
    targets = new Set(['zh']);
    const { getByText } = render(<DisplaySettingsPopover source="conversation" />);
    expect(getByText('R[L(zh)|PINYIN]')).toBeTruthy();
  });

  it('is not drawn when the target has no scheme', () => {
    targets = new Set();
    const { queryByText } = render(<DisplaySettingsPopover source="conversation" />);
    expect(queryByText(/^R\[/)).toBeNull();
  });

  it('is not drawn in the subtitle popover unless offered (compact view, extension overlay)', () => {
    const { queryByText, rerender } = render(<DisplaySettingsPopover source="subtitle" />);
    expect(queryByText(/^R\[/)).toBeNull();
    rerender(<DisplaySettingsPopover source="subtitle" readingsOffered />);
    expect(queryByText('R[L(ja)|KANA]')).toBeTruthy();
  });

  it("switches its own surface's store and sends one event", () => {
    const { getByRole } = render(<DisplaySettingsPopover source="subtitle" readingsOffered />);
    fireEvent.click(getByRole('switch', { name: /R\[/ }));
    expect(useSubtitleStore.getState().showReadings).toBe(true);
    expect(useConversationDisplayStore.getState().showReadings).toBe(false);
    expect(trackEvent).toHaveBeenCalledWith('readings_changed', { surface: 'subtitle', language: 'ja', enabled: true });
  });

  it('shows the Japanese download while the switch is on, and a retry after a failure', () => {
    useConversationDisplayStore.setState({ showReadings: true } as never);
    japanese = { phase: 'downloading', done: 7_340_032, total: 17_750_350 };
    const { getByText, rerender, getByRole } = render(<DisplaySettingsPopover source="conversation" />);
    expect(getByText('DL 7.0 MB/16.9 MB')).toBeTruthy();
    japanese = { phase: 'failed' };
    rerender(<DisplaySettingsPopover source="conversation" />);
    expect(getByText('DL FAILED')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'AGAIN' }));
    expect(retryJapanese).toHaveBeenCalled();
  });
});
```

The `ToggleSwitch` renders `role="switch"` with the label as a sibling `<span>`; if `getByRole('switch', { name })` cannot find it by name, pass `ariaLabel={label}` to the `ToggleSwitch` in Step 4 (it supports `ariaLabel`).

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/components/Display/DisplaySettingsPopover.readings.test.tsx`
Expected: FAIL, no readings row.

- [ ] **Step 4: Change `DisplaySettingsPopover.tsx`**

Imports:

```tsx
import { useSyncExternalStore } from 'react';
import Button from '../Settings/shared/Button';
import { useAnalytics } from '../../lib/analytics';
import { useLanguageLabel } from '../../lib/language/useLanguageLabel';
import { formatBytes } from '../../lib/local-inference/formatBytes';
import { getJapaneseState, retryJapanese, subscribeJapanese, type JapaneseState } from '../../lib/reading/ja/runtime';
import { READING_SCHEME } from '../../lib/reading/types';
import { useReadingTargets } from '../../lib/reading/useReadingTargets';
```

plus the four store hooks from B10 (`useConversationDisplayShowReadings`, `useSetConversationDisplayShowReadings`, `useSubtitleShowReadings`, `useSetSubtitleShowReadings`). `useSyncExternalStore` joins the existing `react` import.

Props and wrappers:

```tsx
export interface DisplaySettingsPopoverProps {
  source: Source;
  /** Whether this surface draws readings. The conversation always does; the subtitle only in Electron, expanded. */
  readingsOffered?: boolean;
}

const DisplaySettingsPopover: React.FC<DisplaySettingsPopoverProps> = ({ source, readingsOffered }) =>
  source === 'subtitle'
    ? <SubtitleBoundPopover readingsOffered={readingsOffered ?? false} />
    : <ConversationBoundPopover readingsOffered={readingsOffered ?? true} />;
```

`InnerBindings` gains:

```tsx
  showReadings: boolean;
  setShowReadings: (b: boolean) => Promise<void>;
  surface: 'conversation' | 'subtitle';
```

Each wrapper takes `{ readingsOffered }: { readingsOffered: boolean }`, fills the three new bindings from its own store (`surface: 'subtitle'` / `'conversation'`), and renders `<DisplaySettingsPopoverInner bindings={bindings} readingsOffered={readingsOffered} />`.

In `DisplaySettingsPopoverInner` (now `({ bindings, readingsOffered })`), after the three `ColorRow`s and before the highlight toggle:

```tsx
      {readingsOffered && <ReadingsRow bindings={bindings} />}
```

New components in the same file:

```tsx
const SCHEME_FALLBACK = { kana: 'kana', pinyin: 'pinyin', rr: 'romanization', latin: 'Latin letters' } as const;

/** The readings switch (spec 2026-10-15 §5): named by the target's reading language; absent when it has none. */
const ReadingsRow: React.FC<{ bindings: InnerBindings }> = ({ bindings }) => {
  const { t } = useTranslation();
  const targets = useReadingTargets();
  const languageName = useLanguageLabel();
  const { trackEvent } = useAnalytics();
  const japanese = useSyncExternalStore(subscribeJapanese, getJapaneseState);
  const lang = targets.values().next().value;
  if (!lang) return null;
  const scheme = READING_SCHEME[lang];
  const label = t('subtitle.settings.readings', {
    defaultValue: 'Show {{language}} readings ({{scheme}})',
    language: languageName(lang),
    scheme: t(`subtitle.settings.readingScheme.${scheme}`, SCHEME_FALLBACK[scheme]),
  });
  const toggle = () => {
    const next = !bindings.showReadings;
    void bindings.setShowReadings(next);
    trackEvent('readings_changed', { surface: bindings.surface, language: lang, enabled: next });
  };
  return (
    <div className="field readings-field">
      <ToggleSwitch checked={bindings.showReadings} onChange={toggle} label={label} ariaLabel={label} />
      {bindings.showReadings && lang === 'ja' && <JapaneseDictionaryStatus state={japanese} />}
    </div>
  );
};

const JapaneseDictionaryStatus: React.FC<{ state: JapaneseState }> = ({ state }) => {
  const { t } = useTranslation();
  if (state.phase === 'downloading') {
    return (
      <div className="readings-download" role="status">
        <div className="readings-download__bar"><i style={{ width: `${Math.round((state.done / state.total) * 100)}%` }} /></div>
        <div className="readings-download__text">
          {t('subtitle.settings.readingsDownloading', {
            defaultValue: 'Downloading the Japanese dictionary {{done}} / {{total}}',
            done: formatBytes(state.done),
            total: formatBytes(state.total),
          })}
        </div>
      </div>
    );
  }
  if (state.phase === 'failed') {
    return (
      <div className="readings-download readings-download--failed" role="alert">
        <span className="readings-download__text">{t('subtitle.settings.readingsDownloadFailed', "Couldn't download the Japanese dictionary.")}</span>
        <Button variant="secondary" size="sm" onClick={retryJapanese}>{t('common.retry', 'Retry')}</Button>
      </div>
    );
  }
  return null;
};
```

Check `Button`'s props in `src/components/Settings/shared/Button.tsx` (it has `variant` and `size`; confirm `onClick` and `children`).

- [ ] **Step 5: Style the status** — append inside `.display-settings-popover` in `DisplaySettingsPopover.scss`

```scss
  .readings-download {
    margin-top: 6px;
    display: grid;
    gap: 4px;

    &__bar {
      height: 3px;
      background: #333;
      border-radius: 2px;
      overflow: hidden;

      i {
        display: block;
        height: 100%;
        background: tk.$color-primary;
      }
    }

    &__text {
      font-size: 11px;
      color: #9aa0a6;
      font-variant-numeric: tabular-nums;
    }

    &--failed {
      grid-template-columns: 1fr auto;
      align-items: center;
    }
  }
```

Compile it: `./node_modules/.bin/sass --no-source-map --load-path=src/styles src/components/Display/DisplaySettingsPopover.scss > /dev/null`.

- [ ] **Step 6: Offer it in the Electron subtitle view only**

In `src/components/Subtitle/SubtitleBar.tsx`, both sites become:

```tsx
<DisplaySettingsPopover source="subtitle" readingsOffered={surface === 'electron' && !subtitle.compactMode} />
```

`PanelToolbar` keeps `<DisplaySettingsPopover source="conversation" />` (offered by default).

- [ ] **Step 7: Declare the event** — in `src/lib/analytics.ts`, beside the caption-share events:

```ts
  // Readings (#545, spec 2026-10-15 R16): the switch only.
  'readings_changed': { surface: 'conversation' | 'subtitle'; language: string; enabled: boolean };
```

- [ ] **Step 8: Run the popover tests**

Run: `npx vitest run src/components/Display src/components/Subtitle src/components/MainPanel`
Expected: PASS, the existing `DisplaySettingsPopover.test.tsx` unchanged.

- [ ] **Step 9: Fill the other 29 catalogs**

```bash
node scripts/sync-locale-keys.mjs
```

This copies the English values into every catalog as placeholders. Then translate each new value in each of the 29 catalogs (`src/locales/<lang>/translation.json`, `subtitle.settings.readings`, `readingScheme.*`, `readingsDownloading`, `readingsDownloadFailed`). Keep `{{language}}`, `{{scheme}}`, `{{done}}`, `{{total}}` exactly. Reuse each catalog's own vocabulary: its word for "download" from `models.*`, its punctuation style from its `subtitle.settings` neighbours. These four are fixed:

| key | zh_CN | zh_TW | ja | ko |
|---|---|---|---|---|
| readings | 显示{{language}}读音（{{scheme}}） | 顯示{{language}}讀音（{{scheme}}） | {{language}}の読みを表示（{{scheme}}） | {{language}} 읽는 법 표시({{scheme}}) |
| readingScheme.kana | 假名 | 假名 | かな | 가나 |
| readingScheme.pinyin | 拼音 | 拼音 | ピンイン | 병음 |
| readingScheme.rr | 罗马字 | 羅馬字 | ローマ字 | 로마자 |
| readingScheme.latin | 拉丁字母 | 拉丁字母 | ラテン文字 | 라틴 문자 |
| readingsDownloading | 正在下载日语词典 {{done}} / {{total}} | 正在下載日語詞典 {{done}} / {{total}} | 日本語辞書をダウンロード中 {{done}} / {{total}} | 일본어 사전 다운로드 중 {{done}} / {{total}} |
| readingsDownloadFailed | 日语词典下载失败。 | 日語詞典下載失敗。 | 日本語辞書をダウンロードできませんでした。 | 일본어 사전을 다운로드하지 못했습니다. |

Then check that no catalog other than `en` still carries the English values:

```bash
node -e "
const fs=require('fs');const en=JSON.parse(fs.readFileSync('src/locales/en/translation.json')).subtitle.settings;
const keys=['readings','readingsDownloading','readingsDownloadFailed'];
for (const l of fs.readdirSync('src/locales')) { const p='src/locales/'+l+'/translation.json'; if(!fs.existsSync(p)||l==='en') continue;
  const s=JSON.parse(fs.readFileSync(p)).subtitle.settings; for (const k of keys) if (s[k]===en[k]) console.log('UNTRANSLATED', l, k);
  for (const k of ['kana','pinyin','rr','latin']) if (s.readingScheme[k]===en.readingScheme[k] && !['pinyin'].includes(k)) console.log('CHECK', l, 'readingScheme.'+k, s.readingScheme[k]); }"
npx vitest run src/locales
```

Expected: no `UNTRANSLATED` line; `CHECK` lines only where the English word is that language's own word too (judge each); the locale consistency tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/Display/DisplaySettingsPopover.tsx src/components/Display/DisplaySettingsPopover.scss src/components/Display/DisplaySettingsPopover.readings.test.tsx src/components/Subtitle/SubtitleBar.tsx src/lib/analytics.ts src/locales
git commit -m "feat(reading): the readings switch in the display popover, in 30 languages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B13: Whole-branch verification, docs, and the live check

**Files:**
- Modify: `CLAUDE.md` (one bullet under "Key Architectural Components")

- [ ] **Step 1: Full suite and types**

```bash
npx vitest run 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Compare the type-error count against main's with a throwaway worktree (never `git stash`: the stash is shared with other sessions):

```bash
git worktree add /tmp/ruby-tsc-base origin/main -f >/dev/null 2>&1
(cd /tmp/ruby-tsc-base && ln -sfn /home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules node_modules && npx tsc --noEmit 2>&1 | grep -c "error TS")
git worktree remove --force /tmp/ruby-tsc-base
```

Expected: every test passes; this branch adds no type errors over main's count.

- [ ] **Step 2: Builds keep the wasm out**

```bash
npm run build
npm run extension:build
npm run check:no-lindera-wasm
ls build/assets | grep -i lindera
```

Expected: `No Lindera wasm in build, extension/dist`, and the worker chunk (`lindera.worker-*.js`) present at tens of KB, not megabytes.

- [ ] **Step 3: Render check**

Render the panel at 300 px and 450 px with readings on, for a Japanese and a Chinese target, and the popover row in its four states, using the method in the memory note "settle by rendering" (a harness page with the compiled SCSS, or the renderer-only dev server). Compare against the approved candidates at https://claude.ai/artifact/3H3aMhr7434uYxEVBqKCZf (R2, per character, C). Check that the Electron subtitle settings popover (a child window of fixed height 400) scrolls to the new row rather than cutting it off.

- [ ] **Step 4: Document it** — in `CLAUDE.md`, after the "LAN caption sharing" item, add:

```markdown
8. **Readings** (spec: `docs/superpowers/specs/2026-10-15-pronunciation-ruby-design.md`)
   - A switch per surface in the display popover shows the pair target's language as ruby:
     pinyin (`pinyin-pro`), kana (Lindera WASM + IPADIC in a worker), Korean RR and
     Russian/Ukrainian Latin (`src/lib/reading/`). View-only: never on `Row`, TTS or exports.
   - The Lindera wasm (17 MB) is downloaded once from `sokuji.kizuna.ai/reading/` (served by
     sokuji-backend's `web/scripts/reading-assets.mjs`), checked by size and SHA-256 and kept in
     `sokuji-models`; `vite.lindera-wasm-url.ts` keeps it out of every build
     (`npm run check:no-lindera-wasm`). A Lindera bump moves the version, size and hash in both repos.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: readings in CLAUDE.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Stop for the owner**

Report: the branch `worktree-pronunciation-ruby` in kizuna-ai-lab/sokuji (unpushed) and `feat/reading-wasm` in kizuna-ai-lab/sokuji-backend (unpushed). Ask, separately and naming each, before pushing either or opening either PR. The live check needs the backend deployed first:

1. `curl -sI https://sokuji.kizuna.ai/reading/lindera-ipadic-2.3.4.wasm` → 200, `content-length: 17750350`, `access-control-allow-origin: *`.
2. Electron (`npm run electron:dev`), pair 中文 → 日本語: switch on in the panel, the download line runs and the rows gain kana; restart the app: no second download.
3. Same with the target 中文 (pinyin), 한국어, Русский; target English: no row in the popover.
4. Electron subtitle view: the row appears expanded, disappears compact; readings follow the subtitle switch, not the panel's.
5. Extension side panel (built extension loaded unpacked): the Japanese download crosses the extension's CSP; the page overlay shows no readings row.
6. Speak while watching a row grow: the last word's reading appears only when the row is final, no あきら-style flash.
```

