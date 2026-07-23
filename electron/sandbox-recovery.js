/**
 * Windows sandbox crash self-healing (issue #352).
 *
 * On some Windows machines, other software (e.g. OpenAI Codex CLI's elevated
 * sandbox, Google Antigravity's Gemini sandbox, or MSIX installers that leave
 * ACEs behind on uninstall) writes an orphaned AppContainer SID ACE onto
 * %LOCALAPPDATA% or %USERPROFILE%. That ACE is inherited by Sokuji's install
 * and data directories. Chromium's sandboxed child processes (GPU, renderer)
 * launch under a restricted token that the corrupted DACL then locks out of
 * the install directory, so the child dies at CHECK(InitializeICU()) while
 * memory-mapping icudtl.dat. After three GPU crashes Chromium fatally kills the
 * whole app, which the user sees as a silent startup crash.
 *
 * The orphan ACE can be removed without administrator rights (the user owns
 * their own profile directories, which implies WRITE_DAC). Removing just the
 * explicit orphan ACE heals the whole inheritance chain.
 *
 * Everything here is gated on win32 at the call sites in main.js. This module
 * intentionally does NOT require('electron') at load time so it stays unit
 * testable under plain Node/vitest; electron `app`/`dialog` are passed in.
 *
 * Upstream: https://github.com/electron/electron/issues/51761
 * Issue:    https://github.com/kizuna-ai-lab/sokuji/issues/352
 */

// Orphan AppContainer package SID: "S-1-15-2" followed by 6+ sub-authority
// groups. This deliberately excludes the legit well-known capability SIDs
// S-1-15-2-1 (ALL APPLICATION PACKAGES) and S-1-15-2-2 (ALL RESTRICTED
// APPLICATION PACKAGES), which have only a single sub-authority.
const ORPHAN_SID_RE = /S-1-15-2(?:-\d+){6,}/;

/**
 * Parse one directory's `icacls <dir>` output into orphan-SID ACE records.
 *
 * Processes line by line and extracts only ASCII SID + flag tokens, so the OEM
 * code page and any localized account names in the surrounding text are
 * irrelevant. An ACE is treated as inherited only when its trailing flag list
 * contains the standalone "(I)" group (distinct from "(OI)", "(CI)", "(IO)").
 *
 * @param {string} text - icacls output (already decoded to a JS string).
 * @returns {Array<{sid: string, inherited: boolean}>} one entry per line that
 *   carries an orphan AppContainer SID.
 */
function parseIcaclsAces(text) {
  const results = [];
  for (const line of String(text).split(/\r?\n/)) {
    const sidMatch = line.match(ORPHAN_SID_RE);
    if (!sidMatch) continue;

    // Grab the trailing run of consecutive "(...)" flag groups. The account
    // name may itself contain "(S-1-15-2-...)", but that is separated from the
    // flags by the ":" delimiter, so the trailing run never includes it.
    const flagsMatch = line.match(/((?:\([^)]*\))+)\s*$/);
    const flags = flagsMatch ? flagsMatch[1] : '';
    const groups = (flags.match(/\(([^)]*)\)/g) || []).map((g) => g.slice(1, -1));
    const inherited = groups.includes('I');

    results.push({ sid: sidMatch[0], inherited });
  }
  return results;
}

/**
 * Unique list of EXPLICIT (non-inherited) orphan SIDs defined at a directory.
 * These are the only ACEs the repair step ever removes.
 *
 * @param {string} text - icacls output.
 * @returns {string[]}
 */
function findExplicitOrphanSids(text) {
  const seen = new Set();
  for (const ace of parseIcaclsAces(text)) {
    if (!ace.inherited) seen.add(ace.sid);
  }
  return [...seen];
}

module.exports = {
  ORPHAN_SID_RE,
  parseIcaclsAces,
  findExplicitOrphanSids,
};
