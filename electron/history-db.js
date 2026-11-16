// electron/history-db.js
//
// Opens History's SQLite file: reads its version, refuses a file from a newer app, sets the pragmas, copies an
// older file aside and migrates it step by step. The only file that touches `node:sqlite`; should the binding
// ever change, only this file does.
'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { MIGRATIONS } = require('./history-schema.js');

class HistoryNewerError extends Error {
  constructor(found, known) {
    super(`History was written by a newer version of the app (schema ${found}; this version knows ${known})`);
    this.name = 'HistoryNewerError';
    this.code = 'HISTORY_NEWER';
    this.found = found;
    this.known = known;
  }
}

class HistoryMigrationError extends Error {
  constructor(version, broken) {
    super(`History's migration to version ${version} left ${broken} broken reference(s); nothing was changed`);
    this.name = 'HistoryMigrationError';
    this.code = 'HISTORY_MIGRATION';
  }
}

/** Runs `fn` between BEGIN IMMEDIATE and COMMIT; rolls back and rethrows when it throws. */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* the transaction is already gone */ }
    throw error;
  }
}

/**
 * Opens (or creates) the file and brings it to `migrations.length`. Returns `{ db, version, migratedFrom }`.
 * The version is read before any pragma is set: `journal_mode = WAL` writes the file's header, and a file from
 * a newer app must stay byte for byte as it was.
 */
function openDatabase({ file, migrations = MIGRATIONS }) {
  const db = new DatabaseSync(file);
  try {
    const found = Number(db.prepare('pragma user_version').get().user_version);
    if (found > migrations.length) throw new HistoryNewerError(found, migrations.length);
    db.exec('pragma journal_mode = WAL');
    db.exec('pragma synchronous = NORMAL');
    if (found > 0 && found < migrations.length) {
      // The copy is whole only once the write-ahead log is folded into the file.
      db.exec('pragma wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(file, `${file}.before-v${migrations.length}`);
    }
    // Foreign keys are off while migrating (the pragma is ignored inside a transaction): rebuilding a table, the
    // way SQLite changes a constraint, drops the old one, which would cascade. Each step is checked instead.
    db.exec('pragma foreign_keys = OFF');
    for (let version = found; version < migrations.length; version += 1) {
      transaction(db, () => {
        db.exec(migrations[version]);
        const broken = db.prepare('pragma foreign_key_check').all().length;
        if (broken > 0) throw new HistoryMigrationError(version + 1, broken);
        db.exec(`pragma user_version = ${version + 1}`);
      });
    }
    db.exec('pragma foreign_keys = ON');
    return { db, version: migrations.length, migratedFrom: found };
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openDatabase, transaction, HistoryNewerError, HistoryMigrationError };
