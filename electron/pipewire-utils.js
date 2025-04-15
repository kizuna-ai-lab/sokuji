const { spawn, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

let loopbackProcess = null;

/**
 * Check if PipeWire is enabled on the system
 * @returns {Promise<boolean>} True if PipeWire is enabled, false otherwise
 */
async function isPipeWireEnabled() {
  try {
    const { stdout } = await execPromise('pactl info | grep "Server Name" | grep -i pipewire');
    return stdout.trim().length > 0;
  } catch (error) {
    console.error('PipeWire check failed:', error);
    return false;
  }
}

/**
 * Check if pw-loopback is available
 * @returns {Promise<boolean>} True if pw-loopback is available, false otherwise
 */
async function isPwLoopbackAvailable() {
  try {
    const { stdout } = await execPromise('which pw-loopback');
    return stdout.trim().length > 0;
  } catch (error) {
    console.error('pw-loopback check failed:', error);
    return false;
  }
}

/**
 * Start PipeWire loopback to create a virtual microphone
 * @returns {Promise<boolean>} True if loopback was started successfully, false otherwise
 */
async function startPipeWireLoopback() {
  try {
    // Check if PipeWire is enabled
    const pipeWireEnabled = await isPipeWireEnabled();
    if (!pipeWireEnabled) {
      console.error('PipeWire is not enabled on this system');
      return false;
    }

    // Check if pw-loopback is available
    const pwLoopbackAvailable = await isPwLoopbackAvailable();
    if (!pwLoopbackAvailable) {
      console.error('pw-loopback is not available on this system');
      return false;
    }

    // Start pw-loopback to create a virtual microphone
    // This creates an audio loopback from the default output to a virtual microphone input
    loopbackProcess = spawn('pw-loopback', [
      '--capture-props=media.class=Audio/Source', 
      '--playback-props=media.class=Audio/Sink',
      '--capture-props=node.name=sokuji-input,node.description="Sokuji virtual microphone"',
      '--playback-props=node.name=sokuji-output,node.description="Sokuji virtual speaker"'
    ]);

    loopbackProcess.stdout.on('data', (data) => {
      console.log(`pw-loopback stdout: ${data}`);
    });

    loopbackProcess.stderr.on('data', (data) => {
      console.error(`pw-loopback stderr: ${data}`);
    });

    loopbackProcess.on('close', (code) => {
      console.log(`pw-loopback process exited with code ${code}`);
      loopbackProcess = null;
    });

    return true;
  } catch (error) {
    console.error('Failed to start PipeWire loopback:', error);
    return false;
  }
}

/**
 * Stop the PipeWire loopback process
 */
function stopPipeWireLoopback() {
  if (loopbackProcess) {
    loopbackProcess.kill();
    loopbackProcess = null;
    console.log('PipeWire loopback stopped');
  }
}

module.exports = {
  isPipeWireEnabled,
  isPwLoopbackAvailable,
  startPipeWireLoopback,
  stopPipeWireLoopback
};
