/**
 * The regression guard for #441.
 *
 * CLAUDE.md says caught errors reach the user through LogsPanel. For 154 calls
 * across 27 files they reached `console.error`/`console.warn` instead, and every
 * PR that happened to touch one of those lines collected the same review comment
 * on whichever line it moved — so the debt was being paid down in the order a
 * bot scanned it rather than by impact.
 *
 * A blanket "no console.error" rule would be wrong: some failures legitimately
 * stay console-only (guards for states the UI already prevents, hot paths,
 * contexts that cannot reach the store at all — workers, worklets, the extension
 * background, Electron main). So this is a LEDGER, not a ban: an exact count per
 * file that a PR must lower deliberately.
 *
 * The assertion is `toBe`, not `toBeLessThanOrEqual`. A ceiling can be silently
 * refilled and goes stale; an exact number means deleting a call fails the test
 * until the ledger row is lowered in the same diff, which is the reviewable act
 * that replaces the per-line bot comment.
 *
 * Style follows featureGateForwarding.consistency.test.ts: read the source,
 * derive, assert — including a guard against the scan itself silently matching
 * nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Roots whose files run in the renderer and CAN import the store.
 *
 * `extension/`, `electron/` and `sidecar/` are deliberately absent: they are
 * separate JS contexts with no access to the renderer's store instance, they
 * keep their existing message/IPC channels, and the renderer-side caller is
 * what reports. Listing them would imply a rule nothing can satisfy.
 */
const ROOTS = [
  'src/stores',
  'src/services',
  'src/contexts',
  'src/components',
  'src/lib',
  'shared',
];

/** Top-level entry points, which are files rather than directories. */
const ENTRY_FILES = ['src/subtitle-overlay-entry.tsx'];

const SKIP = [
  /\.test\.tsx?$/,
  /\.d\.ts$/,
  // Cannot import the store: separate realms with their own message channels.
  /[\\/]workers[\\/]/,
  /[\\/]worklets[\\/]/,
];

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(REPO_ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    const rel = join(dir, entry);
    if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
      walk(rel, out);
    } else if (/\.tsx?$/.test(entry) && !SKIP.some((re) => re.test(rel))) {
      out.push(rel);
    }
  }
  return out;
}

const scannedFiles = (): string[] => {
  const files = ROOTS.flatMap((root) => walk(root));
  for (const entry of ENTRY_FILES) {
    if (existsSync(join(REPO_ROOT, entry))) files.push(entry);
  }
  return files.map((f) => f.split('\\').join('/')).sort();
};

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8');

/**
 * Blank out comments and string bodies, so only code is counted.
 *
 * Requiring the trailing `(` is not enough on its own: a doc comment that shows
 * the old shape it replaced (`.catch(e => console.error(...))`) reads as a call.
 * That inflated a row twice while this ledger was being written — once from
 * prose in `UserProfileContext`, once from `persistSetting`'s own header — and
 * each time it sends a reader hunting for a call that is not there.
 *
 * Replaces characters rather than deleting them, so the count is unaffected by
 * how much was blanked.
 */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' '; i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') { out += '  '; i += 2; continue; }
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += ' '; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

const countConsoleCalls = (source: string): number =>
  (stripCommentsAndStrings(source).match(/console\.(?:error|warn)\(/g) ?? []).length;

/**
 * Exact remaining `console.error(` / `console.warn(` per file.
 *
 * Lower a row in the same PR that removes the calls; delete the row when it
 * reaches 0. Unlisted files must be 0, so new files start clean.
 *
 * PR1 cleared: UserProfileContext (6), EphemeralTokenService (3),
 * settingsStore's 8 non-persist sites, OpenAIWebRTCClient's duplicate addLog.
 * PR2 takes the persistence seam, PR3 the client contract, PR4 the remainder.
 */
const LEDGER: Record<string, number> = {
  // --- PR3 — the client contract (onError / onDiagnostic / onConnectFailed) ---
  'src/services/clients/LocalInferenceClient.ts': 7,
  'src/services/clients/SonioxClient.ts': 7,
  'src/services/clients/OpenAIWebRTCClient.ts': 5,
  'src/services/clients/ManagedSonioxSession.ts': 3,
  'src/services/clients/OpenAITranslateWebRTCClient.ts': 3,
  'src/services/clients/OpenAIClient.ts': 2,
  'src/services/clients/ZoomAIClient.ts': 2,
  'src/services/clients/LocalNativeClient.ts': 1,
  'src/services/clients/OpenAITranslateGAClient.ts': 1,
  // --- PR4 — provider config and onboarding ---
  'src/services/providers/localParticipantConfig.ts': 2,
  'src/services/providers/managedVoicePrep.ts': 2,
  'src/contexts/OnboardingContext.tsx': 1,
  'src/services/providers/SonioxProviderConfig.ts': 1,
  // --- Later, under the ledger: components ---
  'src/components/MainPanel/MainPanel.tsx': 44,
  'src/components/Auth/UserAccountInfo.tsx': 5,
  'src/components/Settings/sections/VoiceLibrarySection.tsx': 5,
  'shared/index.tsx': 4,
  'src/components/SettingsInitializer/SettingsInitializer.tsx': 3,
  'src/components/Auth/ForgotPasswordForm.tsx': 2,
  'src/components/MainPanel/participantTelemetry.ts': 2,
  'src/components/Settings/sections/ModelManagementSection.tsx': 2,
  'src/components/Settings/sections/ProviderSpecificSettings.tsx': 2,
  'src/components/Auth/SignInForm.tsx': 1,
  'src/components/Auth/SignUpForm.tsx': 1,
  'src/components/Onboarding/Onboarding.tsx': 1,
  'src/components/Settings/AdvancedSettings/AdvancedSettings.tsx': 1,
  'src/components/Settings/engine/EnginePage.tsx': 1,
  'src/components/Subtitle/ChildWindowPopover.tsx': 1,
  'src/components/Toast/ToastContext.tsx': 1,
  'src/subtitle-overlay-entry.tsx': 1,
  // --- Later, under the ledger: src/lib (audio pipeline and helpers) ---
  'src/lib/modern-audio/ModernBrowserAudioService.ts': 29,
  'src/lib/modern-audio/WebRTCAudioBridge.ts': 10,
  'src/lib/modern-audio/AppAudioRecorder.ts': 9,
  'src/lib/modern-audio/ModernAudioRecorder.ts': 9,
  'src/lib/analytics.ts': 6,
  'src/lib/modern-audio/LoopbackRecorder.ts': 6,
  'src/lib/modern-audio/BaseAudioRecorder.ts': 2,
  'src/lib/modern-audio/TabAudioRecorder.ts': 2,
  'src/lib/edge-tts/EdgeTtsConnection.ts': 1,
  'src/lib/local-inference/modelStorage.ts': 1,
  'src/lib/local-inference/nativeVoiceStorage.ts': 1,
  'src/lib/modern-audio/ParticipantRecorder.ts': 1,
  'src/lib/soniox/voiceClipStorage.ts': 1,
};

describe('console ledger', () => {
  // Guards the derivation itself. Without this, a broken walk or a regex that
  // stops matching would make every assertion below pass over an empty set —
  // the failure mode that makes a consistency test worse than no test.
  it('finds the tree and matches the pattern', () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain('src/stores/logStore.ts');
    expect(countConsoleCalls('a; console.error("x"); console.warn(y); console.info(z)')).toBe(2);
    // Prose must not count — in a line comment, a block comment, or a string.
    expect(countConsoleCalls('// its console.error( could not fire')).toBe(0);
    expect(countConsoleCalls('/** was .catch(e => console.error(e)) */')).toBe(0);
    expect(countConsoleCalls('const help = "use console.error( for this";')).toBe(0);
    // ...and code after a comment still must.
    expect(countConsoleCalls('/* console.warn( */ console.error(x);')).toBe(1);
    expect(countConsoleCalls('// note\nconsole.warn(x);')).toBe(1);
  });

  it('every ledger row names a file that exists', () => {
    for (const file of Object.keys(LEDGER)) {
      expect(existsSync(join(REPO_ROOT, file)), `${file}: stale ledger row`).toBe(true);
    }
  });

  it('console.error/warn per file equals the ledger exactly', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const actual = countConsoleCalls(read(file));
      const allowed = LEDGER[file] ?? 0;
      if (actual === allowed) continue;
      offenders.push(
        actual > allowed
          ? `${file}: ${actual} console.error/warn calls, ledger allows ${allowed}. ` +
            'Use reportError/reportWarning from src/lib/diagnostics/report.ts.'
          : `${file}: ${actual} calls but ledger says ${allowed}. ` +
            'Lower the row in this PR so the ledger stays exact.',
      );
    }
    expect(offenders).toEqual([]);
  });

  // Only report.ts writes plain panel entries, so redaction, throttling and the
  // deferred write cannot be bypassed. `\baddLog\(` rather than `\.addLog\(`:
  // MainPanel destructures it from useLogActions(), which the dotted form
  // cannot see.
  it('plain panel entries are written only through report.ts', () => {
    const ALLOWED = [
      /src\/stores\/logStore\.ts$/,
      /src\/lib\/diagnostics\/report\.ts$/,
      // Reads the log list and calls clearLogs; never writes an entry.
      /src\/components\/LogsPanel\/LogsPanel\.tsx$/,
      // The echo notice. Migrates with the rest of MainPanel in PR3a; listed
      // here so PR1 does not have to touch the repo's most-edited file.
      /src\/components\/MainPanel\/MainPanel\.tsx$/,
    ];
    const writers = scannedFiles().filter((file) => {
      if (ALLOWED.some((re) => re.test(file))) return false;
      return /\baddLog\(|\buseAddLog\b|\buseLogActions\b/.test(read(file));
    });
    expect(writers).toEqual([]);
  });

  // The caught value goes in `cause`, which never leaves the console. Passing a
  // serialised object as the message is how EphemeralTokenService.ts came to
  // hand a whole client-secret response to the log.
  it('no object serialisation inside a report call', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      for (const match of read(file).matchAll(/report(?:Error|Warning)\(([\s\S]{0,400}?)\);/g)) {
        if (match[1].includes('JSON.stringify(')) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  // report.ts and its dependencies must not reach back into services,
  // components or contexts: logStore is a leaf today and the deferred-write
  // guarantee depends on it staying cheap to import from anywhere.
  it('the diagnostics modules stay leaves', () => {
    const LEAVES = [
      'src/lib/diagnostics/redact.ts',
      'src/lib/diagnostics/report.ts',
      'src/stores/sanitizeEvent.ts',
      'src/stores/logStore.ts',
    ];
    const FORBIDDEN = /from '[^']*(?:services|components|contexts)\//;
    for (const leaf of LEAVES) {
      const imports = read(leaf)
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line) && !/^\s*import type\b/.test(line));
      expect(imports.filter((l) => FORBIDDEN.test(l)), `${leaf} must stay a leaf`).toEqual([]);
    }
  });

  // Clients cannot know which session leg they are on, so they report through
  // handlers that MainPanel owns. A client importing the store or the reporter
  // as a value would file its failures under the wrong tab.
  it('clients never import the store or the reporter as a value', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles().filter((f) => f.startsWith('src/services/clients/'))) {
      for (const line of read(file).split('\n')) {
        if (!/^\s*import\b/.test(line) || /^\s*import type\b/.test(line)) continue;
        if (/stores\/logStore|lib\/diagnostics\/report/.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
