import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { ignoreStdioErrors, createExitHandler } from './exit-handler.js';

const epipe = () => Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' });

describe('ignoreStdioErrors', () => {
  it('keeps a failed write to stdout or stderr from throwing', () => {
    const stdout = new Writable({ write: (_chunk, _enc, cb) => cb() });
    const stderr = new Writable({ write: (_chunk, _enc, cb) => cb() });
    ignoreStdioErrors([stdout, stderr]);

    expect(() => stdout.emit('error', epipe())).not.toThrow();
    expect(() => stderr.emit('error', epipe())).not.toThrow();
    // Every one of them, not just the first.
    expect(() => stdout.emit('error', epipe())).not.toThrow();
  });

  // The incident: an AppImage whose stdout was a pipe nobody read any more. One
  // EPIPE escaped as an uncaught exception, the handler logged, the log raised
  // the next EPIPE, and it ran ~80 times a second for 15 hours.
  it('turns no write into an uncaught exception once the log reader is gone', async () => {
    const child = spawn(process.execPath, ['-e', `
      require(${JSON.stringify(join(__dirname, 'exit-handler.js'))}).ignoreStdioErrors();
      let uncaught = 0;
      // What main.js's handler does first: log, to the same dead pipe.
      process.on('uncaughtException', () => {
        uncaught++;
        console.log('[Sokuji] [Main] Received uncaughtException signal. Ensuring cleanup before exit...');
      });
      process.on('message', () => {
        // Alone in its tick: console swallows its own write errors, and one
        // console call beside this write would swallow this one's too.
        process.stdout.write('a direct write\\n');
        setTimeout(() => {
          console.log('a console line');
          console.error('a console error');
        }, 20);
        setTimeout(() => process.send(uncaught, () => process.exit(0)), 200);
      });
      process.send('ready');
    `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const messages = [];
    child.on('message', (m) => messages.push(m));
    const exited = new Promise((resolve) => child.on('exit', resolve));

    await vi.waitFor(() => expect(messages).toContain('ready'));
    // Close the reading end, and only once it is closed let the child write.
    const closed = (stream) => new Promise((resolve) => stream.once('close', resolve).destroy());
    await Promise.all([closed(child.stdout), closed(child.stderr)]);
    child.send('go');
    await exited;

    expect(messages).toEqual(['ready', 0]);
  });
});

describe('createExitHandler', () => {
  it('cleans up, then exits 0 for a signal and 1 for a crash', () => {
    const order = [];
    const cleanup = () => order.push('cleanup');
    const exit = (code) => order.push(`exit ${code}`);

    createExitHandler({ cleanup, exit })('SIGTERM');
    createExitHandler({ cleanup, exit })('SIGINT');
    createExitHandler({ cleanup, exit })('uncaughtException');

    expect(order).toEqual(['cleanup', 'exit 0', 'cleanup', 'exit 0', 'cleanup', 'exit 1']);
  });

  // Electron's process.exit() returns and quits later. An exception that recurs
  // meanwhile reached the handler again each time, and each pass unloaded the
  // virtual devices with a blocking pactl call, which kept the quit from landing.
  it('runs once, however many exceptions arrive before the exit lands', () => {
    const cleanup = vi.fn();
    const exit = vi.fn();
    const handleExit = createExitHandler({ cleanup, exit });

    handleExit('uncaughtException');
    handleExit('uncaughtException');
    handleExit('SIGTERM');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
