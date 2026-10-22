/**
 * The colour ledger (spec 2026-10-22 §7).
 *
 * Every chrome colour is a `--sk-*` token that each scheme sets; a literal
 * colour in a component's stylesheet or code reads in one scheme only. This
 * is a LEDGER, not a ban, in the shape of consoleLedger.consistency.test.ts:
 * an exact count of colour literals per file, lowered in the same diff that
 * removes them, so a migration is reviewable row by row and nothing refills
 * silently. Unlisted files must be 0, so new files start clean.
 *
 * Exempt: the theme and the two alias files (where the colours live), and the
 * allow-list — brand marks, the user colour presets and defaults, the LAN
 * viewer (its own `--v-*` schemes) and the dev previews.
 *
 * Counting. Stylesheets: hex, `rgb()`/`rgba()`/`hsl()`/`hsla()` and the words
 * `white`/`black` as values, with comments stripped first. Code: through the
 * compiler's parser, every string or template text that IS a hex colour or
 * starts an `rgb(`/`hsl(` call — prose in comments never counts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = resolve(__dirname, '../..');
const ROOTS = ['src', 'shared'];
const SKIP = [/\.test\.[jt]sx?$/, /\.d\.ts$/, /[\\/]node_modules[\\/]/];
const EXEMPT = new Set([
  'src/styles/theme.scss',
  'src/styles/_tokens.scss',
  'src/components/Settings/shared/_variables.scss',
  // brand marks, drawn in their owners' colours
  'src/components/Icons/ProviderIcons.tsx',
  'src/providers/qwen_livetranslate/kizuna.ts',
  // the user's own colours: presets, pickers and defaults (R3)
  'src/components/Display/DisplaySettingsPopover.tsx',
  'src/components/Display/ColorPicker.tsx',
  'src/components/Display/ColorPicker.scss',
  'src/stores/subtitleStore.ts',
  'src/stores/conversationDisplayStore.ts',
  // arithmetic on the user's own subtitle colour: its alpha form, and the
  // highlight overlay drawn on it by tone (white or black by design)
  'src/components/Subtitle/useSubtitleChrome.tsx',
  // a QR code is black on white for the camera, in every scheme
  'src/components/CaptionShare/QrCode.tsx',
]);
const EXEMPT_DIRS = ['src/viewer/', 'src/components/dev/'];

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(REPO_ROOT, dir);
  for (const entry of readdirSync(abs)) {
    const rel = join(dir, entry).split('\\').join('/');
    if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
      if (entry !== 'node_modules') walk(rel, out);
    } else if (/\.(scss|css|tsx?)$/.test(entry) && !SKIP.some((re) => re.test(rel))) {
      out.push(rel);
    }
  }
  return out;
}

const scannedFiles = (): string[] =>
  ROOTS.flatMap((root) => walk(root))
    .filter((f) => !EXEMPT.has(f) && !EXEMPT_DIRS.some((d) => f.startsWith(d)))
    .sort();

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8');

/** Colour literals in a stylesheet, comments stripped: hex, colour functions, `white`/`black` values. */
export function countStyleLiterals(source: string): number {
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const hex = text.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  const fn = text.match(/\b(?:rgba?|hsla?)\(/g) ?? [];
  const words = text.match(/[\s:,(](?:white|black)(?=[\s;,)}!])/g) ?? [];
  return hex.length + fn.length + words.length;
}

const isColourText = (text: string) => /^#[0-9a-f]{3,8}$/i.test(text.trim()) || /^\s*(?:rgba?|hsla?)\(/.test(text);

/** Colour literals in code: string and template texts, via the compiler, so prose never counts. */
export function countCodeLiterals(source: string, fileName = 'scan.tsx'): number {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) {
      if (isColourText(node.text)) count++;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return count;
}

const countIn = (rel: string): number =>
  /\.(scss|css)$/.test(rel) ? countStyleLiterals(read(rel)) : countCodeLiterals(read(rel), rel);

/**
 * Exact remaining colour literals per file. Lower a row in the same diff that
 * migrates the file; delete the row when it reaches 0.
 */
const LEDGER: Record<string, number> = {
  // --- components/MainPanel ---
  // The fallbacks of the user-colour variables (`var(--conversation-bg-color,
  // #1f1f1f)` and the two text colours) are the dark scheme's conversation
  // colours (R3 as amended; MainPanel always sets the variables, so the
  // fallbacks never paint): they stay literal, and these two rows stay.
  'src/components/MainPanel/MainPanel.scss': 1,
  'src/components/MainPanel/ConversationRow.scss': 2,
  // --- components/Subtitle ---
  // The same fallbacks for the subtitle's user colours (`--subtitle-source-color`,
  // `--subtitle-translation-color`, `--subtitle-highlight-overlay`).
  'src/components/Subtitle/SubtitleStream.scss': 4,
  'src/components/Subtitle/SubtitleApp.scss': 1,
};

describe('colour ledger', () => {
  it('finds the tree and matches the patterns', () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('src/components/MainPanel/MainPanel.scss');
    expect(files).toContain('src/components/MainPanel/panel/Waveforms.tsx');
    expect(files).not.toContain('src/styles/theme.scss');
    expect(countStyleLiterals('a { color: #fff; background: rgba(0, 0, 0, .5); border-color: white; }')).toBe(3);
    expect(countStyleLiterals('// #fff\n/* rgba( */\na { color: #1a1a1a; }')).toBe(1);
    expect(countStyleLiterals('a { background: url(https://x/y.png); --v-x: #{tk.$c}; }')).toBe(0);
    expect(countCodeLiterals("const c = '#0099ff'; const d = `rgba(0,0,0,${a})`; // '#fff'\n/* rgb( */")).toBe(2);
    expect(countCodeLiterals('const issue = "#246 fixed"; const key = "settings.common.theme";')).toBe(0);
  });

  it('matches the ledger exactly', () => {
    const counts: Record<string, number> = {};
    for (const file of scannedFiles()) {
      const n = countIn(file);
      if (n > 0) counts[file] = n;
    }
    expect(counts).toEqual(LEDGER);
  });
});
