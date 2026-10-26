const path = require('path');
const { spawnSync } = require('child_process');

// electron-builder afterSign hook: the bridge from the self-signed identity to
// Developer ID.
//
// Squirrel.Mac only installs an update that satisfies the RUNNING app's
// designated requirement (DR). Every release up to v0.46.3 is self-signed, and
// its DR pins that certificate's root:
//
//   identifier "ai.kizunaai.sokuji" and certificate root = H"<sha1>"
//
// so a Developer ID build would be refused by every installed copy. This hook
// re-signs the main bundle with a DR that accepts EITHER that self-signed root
// OR a Developer ID Application certificate of our team. The build is still
// signed with the self-signed certificate (installed copies must accept it),
// but once a user runs it, the next, Developer ID-signed release can replace it.
//
// Only the top-level .app is re-signed, on purpose. electron-builder's own
// `mac.requirements` option is applied to every file it signs (helpers,
// frameworks, dylibs; app-builder-lib/out/mac/MacTargetHelper.js
// getOptionsForFile), and a requirement naming "ai.kizunaai.sokuji" would make
// every helper fail its own designated requirement. Squirrel only checks the
// main bundle, so nested code keeps its default DR.
//
// afterSign runs after codesigning and before the zip and pkg targets are
// built, so both artifacts carry the re-signed bundle.
//
// See docs/build/macos-auto-update.md, "Moving to Developer ID".

// Team ID of the Developer ID Application certificate (developer.apple.com,
// Membership details). Also the OU of that certificate's subject.
const DEVELOPER_ID_TEAM = '48ST7Q3ACJ';

// Apple's documented requirement for "signed with a Developer ID Application
// certificate": anchored at Apple, issued by the Developer ID intermediate
// (1.2.840.113635.100.6.2.6), leaf marked as Developer ID Application
// (1.2.840.113635.100.6.1.13), restricted to one team by the subject OU.
const developerIdClause = (teamId) =>
  'anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and ' +
  `certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${teamId}"`;

/**
 * Reads the designated requirement out of `codesign -d -r-` output.
 * Returns null when there is none; `rootHash` is null for anything that is not
 * pinned to a certificate root (an ad-hoc cdhash DR, or a Developer ID one).
 */
function parseDesignatedRequirement(output) {
  const line = String(output).split('\n').find((l) => l.includes('designated =>'));
  if (!line) return null;
  const requirement = line.replace(/^#?\s*designated =>\s*/, '').trim();
  const identifier = requirement.match(/identifier "([^"]+)"/);
  const root = requirement.match(/certificate root = H"([0-9a-fA-F]{40})"/);
  return {
    requirement,
    identifier: identifier ? identifier[1] : null,
    rootHash: root ? root[1].toLowerCase() : null,
  };
}

/** The transitional DR: the self-signed root OR a Developer ID certificate of `teamId`. */
function buildTransitionalRequirement({ identifier, rootHash, teamId = DEVELOPER_ID_TEAM }) {
  if (!/^[A-Za-z0-9.-]+$/.test(identifier || '')) {
    throw new Error(`[macos-transitional-requirement] Unexpected bundle identifier: ${identifier}`);
  }
  if (!/^[0-9a-f]{40}$/.test(rootHash || '')) {
    throw new Error(`[macos-transitional-requirement] Unexpected certificate root hash: ${rootHash}`);
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId || '')) {
    throw new Error(`[macos-transitional-requirement] Unexpected team ID: ${teamId}`);
  }
  return `identifier "${identifier}" and (certificate root = H"${rootHash}" or ${developerIdClause(teamId)})`;
}

/**
 * Whether a DR already admits Developer ID builds of `teamId`. Matches both the
 * text this script writes and the form `codesign -d -r-` displays it in, which
 * renders `exists` as a `/* exists *\/` comment.
 */
function acceptsDeveloperId(requirement, teamId = DEVELOPER_ID_TEAM) {
  const text = String(requirement);
  const team = new RegExp(`certificate leaf\\[subject\\.OU\\] = "?${teamId}"?(?![A-Z0-9])`);
  return text.includes('anchor apple generic') && team.test(text);
}

// Runs a command without a shell; throws on a non-zero exit. Returns stdout and
// stderr together, because `codesign -d` writes its report to stderr.
function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error(`[macos-transitional-requirement] ${command} ${args.join(' ')} exited ${result.status}:\n${output}`);
  }
  return output;
}

function createAfterSign({ run = runCommand, log = console.log } = {}) {
  const readRequirement = (appPath) => run('codesign', ['-d', '-r-', appPath]);

  return async function afterSign(context) {
    if (context.electronPlatformName !== 'darwin') return;

    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    const current = parseDesignatedRequirement(readRequirement(appPath));

    // Ad-hoc builds (no certificate: forks, local dev) and anything not pinned
    // to a self-signed root have nothing to bridge.
    if (!current || !current.identifier || !current.rootHash) {
      log(`[macos-transitional-requirement] Not signed with a self-signed certificate; leaving ${appPath} as is`);
      return;
    }
    if (acceptsDeveloperId(current.requirement)) {
      log('[macos-transitional-requirement] Designated requirement already admits Developer ID; nothing to do');
      return;
    }

    const requirement = buildTransitionalRequirement({
      identifier: current.identifier,
      rootHash: current.rootHash,
    });
    const identity = context.packager.platformSpecificBuildOptions.identity;
    if (!identity) {
      throw new Error('[macos-transitional-requirement] build.mac.identity is not set; cannot re-sign');
    }
    const { keychainFile } = (await context.packager.codeSigningInfo.value) || {};

    const args = [
      '--force',
      '--sign', identity,
      // Keep everything electron-builder put on the main bundle except the DR.
      '--preserve-metadata=identifier,entitlements,flags,runtime',
      `-r=designated => ${requirement}`,
    ];
    if (keychainFile) args.push('--keychain', keychainFile);
    args.push(appPath);

    log(`[macos-transitional-requirement] Re-signing ${appPath} with a requirement that also admits Developer ID team ${DEVELOPER_ID_TEAM}`);
    run('codesign', args);

    // Fail the build rather than ship a bundle that would strand its users.
    run('codesign', ['--verify', '--deep', '--strict', appPath]);
    const after = parseDesignatedRequirement(readRequirement(appPath));
    if (!after || after.rootHash !== current.rootHash || !acceptsDeveloperId(after.requirement)) {
      throw new Error(`[macos-transitional-requirement] Re-signed bundle has an unexpected requirement: ${after && after.requirement}`);
    }
    log(`[macos-transitional-requirement] designated => ${after.requirement}`);
  };
}

module.exports = createAfterSign();
module.exports.createAfterSign = createAfterSign;
module.exports.runCommand = runCommand;
module.exports.parseDesignatedRequirement = parseDesignatedRequirement;
module.exports.buildTransitionalRequirement = buildTransitionalRequirement;
module.exports.acceptsDeveloperId = acceptsDeveloperId;
module.exports.DEVELOPER_ID_TEAM = DEVELOPER_ID_TEAM;
