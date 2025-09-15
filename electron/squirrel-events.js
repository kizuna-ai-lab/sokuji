const { app } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function handleSquirrelEvent() {
  if (process.argv.length === 1) {
    return false;
  }

  const appFolder = path.resolve(process.execPath, '..');
  const rootAtomFolder = path.resolve(appFolder, '..');
  const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
  const exeName = path.basename(process.execPath);

  const spawnUpdate = function(args) {
    return spawn(updateDotExe, args, { detached: true });
  };

  const squirrelEvent = process.argv[1];

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Create shortcuts on Desktop and Start Menu
      console.log('[Sokuji] Creating shortcuts for:', exeName);
      spawnUpdate(['--createShortcut', exeName]);

      // Always quit when done
      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-uninstall':
      // Remove shortcuts
      console.log('[Sokuji] Removing shortcuts for:', exeName);
      spawnUpdate(['--removeShortcut', exeName]);

      // Always quit when done
      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-obsolete':
      // This is called on the outgoing version before update
      console.log('[Sokuji] Handling obsolete version');
      app.quit();
      return true;
  }

  return false;
};