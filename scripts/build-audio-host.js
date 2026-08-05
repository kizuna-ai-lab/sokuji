#!/usr/bin/env node
/**
 * Build the per-application capture helper for the current platform (issue #335).
 *
 * The binary is not committed: it is produced here, and by CI before packaging.
 * Both packagers ship `resources/` wholesale, so writing into
 * resources/bin/<platform>/ is all that is needed.
 *
 * Linux has no helper - it taps PipeWire directly - so this is a no-op there,
 * and a missing helper is never fatal anyway: the app falls back to
 * whole-system capture.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

if (process.platform === 'linux') {
  console.log('[build:audio-host] Linux taps PipeWire directly; no helper to build.');
  process.exit(0);
}

const job = process.platform === 'win32'
  ? { cmd: path.join(root, 'native', 'audio-host', 'win', 'build.bat'), args: [], shell: true }
  : { cmd: 'bash', args: [path.join(root, 'native', 'audio-host', 'mac', 'build.sh')], shell: false };

const r = spawnSync(job.cmd, job.args, { stdio: 'inherit', shell: job.shell });
if (r.error) {
  console.error(`[build:audio-host] Failed to run the build: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
