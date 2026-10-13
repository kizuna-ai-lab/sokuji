// electron/exit-handler.js
//
// An AppImage whose stdout was a pipe nobody read any more spent 15 hours in a
// loop: one write's EPIPE escaped as an uncaught exception, the exit handler
// logged, the log raised the next EPIPE, and every pass ran the virtual-device
// cleanup - a blocking `pactl` call, ~80 a second - which also unloaded the
// virtual mic. Electron's process.exit() returns and quits later, and that
// quit never landed between passes.

/**
 * A log line that cannot be written is dropped. Node's console swallows most of
 * its own write errors, but not one raised while another is being emitted, and
 * not a direct stream write's; unheard, each is an uncaught exception. A lost
 * log reader is no reason to quit the app, and there is nowhere to report it.
 */
function ignoreStdioErrors(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) stream.on('error', () => {});
}

/**
 * The handler for SIGINT, SIGTERM and a crash. It runs once: an exception that
 * recurs before the quit lands finds the cleanup already done.
 */
function createExitHandler({ cleanup, exit = (code) => process.exit(code) }) {
  let exiting = false;
  return (signal) => {
    if (exiting) return;
    exiting = true;
    console.log(`[Sokuji] [Main] Received ${signal} signal. Ensuring cleanup before exit...`);
    cleanup();
    exit(signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1);
  };
}

module.exports = { ignoreStdioErrors, createExitHandler };
