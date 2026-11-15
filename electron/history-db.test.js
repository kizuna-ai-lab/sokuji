// electron/history-db.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { openDatabase, transaction } = nodeRequire('./history-db.js');
const { SCHEMA_VERSION } = nodeRequire('./history-schema.js');

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sokuji-history-db-'));
  file = join(dir, 'history.db');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('the history database file', () => {
  it('creates a new file at the current version with the pragmas set', () => {
    const { db, version, migratedFrom } = openDatabase({ file });
    expect(version).toBe(SCHEMA_VERSION);
    expect(migratedFrom).toBe(0);
    expect(db.prepare('pragma journal_mode').get().journal_mode).toBe('wal');
    expect(db.prepare('pragma foreign_keys').get().foreign_keys).toBe(1);
    expect(db.prepare("select count(*) c from sqlite_master where type = 'table' and name = 'sentences'").get().c).toBe(1);
    expect(readdirSync(dir).filter((n) => n.includes('before-v'))).toEqual([]);
    db.close();
  });

  it('migrates an older file step by step and keeps a copy of it first', () => {
    const two = ['create table a(x integer) strict', 'alter table a add column y integer'];
    openDatabase({ file, migrations: two.slice(0, 1) }).db.close();
    const { db, version, migratedFrom } = openDatabase({ file, migrations: two });
    expect([migratedFrom, version]).toEqual([1, 2]);
    expect(existsSync(`${file}.before-v2`)).toBe(true);
    expect(db.prepare('pragma table_info(a)').all().map((c) => c.name)).toEqual(['x', 'y']);
    db.close();
  });

  it('refuses a file from a newer version and leaves it untouched', () => {
    openDatabase({ file, migrations: ['create table a(x integer) strict', 'create table b(x integer) strict'] }).db.close();
    const before = readFileSync(file);
    expect(() => openDatabase({ file, migrations: ['create table a(x integer) strict'] }))
      .toThrow(expect.objectContaining({ code: 'HISTORY_NEWER', found: 2, known: 1 }));
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((n) => n.includes('before-v'))).toEqual([]);
  });

  it('a failing migration changes nothing', () => {
    openDatabase({ file, migrations: ['create table a(x integer) strict'] }).db.close();
    expect(() => openDatabase({ file, migrations: ['create table a(x integer) strict', 'this is not sql'] })).toThrow();
    const { db, version } = openDatabase({ file, migrations: ['create table a(x integer) strict'] });
    expect(version).toBe(1);
    db.close();
  });

  it('transaction rolls back when the function throws', () => {
    const { db } = openDatabase({ file, migrations: ['create table a(x integer) strict'] });
    expect(() => transaction(db, () => { db.exec('insert into a values (1)'); throw new Error('no'); })).toThrow('no');
    expect(db.prepare('select count(*) c from a').get().c).toBe(0);
    db.close();
  });

  // Review: a later migration that rebuilds a table (SQLite's way to change a constraint) must not cascade.
  it('a migration that rebuilds a parent table keeps the rows that refer to it', () => {
    const v1 = 'create table p(id text primary key) strict; create table c(p_id text not null references p(id) on delete cascade, x integer) strict';
    const v2 = `create table p_new(id text primary key, note text) strict;
      insert into p_new (id) select id from p;
      drop table p;
      alter table p_new rename to p;`;
    const first = openDatabase({ file, migrations: [v1] }).db;
    first.exec("insert into p values ('a'); insert into c values ('a', 1)");
    first.close();
    const { db } = openDatabase({ file, migrations: [v1, v2] });
    expect(db.prepare('select count(*) n from c').get().n).toBe(1);
    expect(db.prepare('pragma foreign_keys').get().foreign_keys).toBe(1);
    db.close();
  });

  it('a migration that leaves a broken reference changes nothing', () => {
    const v1 = 'create table p(id text primary key) strict; create table c(p_id text not null references p(id) on delete cascade) strict';
    const first = openDatabase({ file, migrations: [v1] }).db;
    first.exec("insert into p values ('a'); insert into c values ('a')");
    first.close();
    expect(() => openDatabase({ file, migrations: [v1, 'delete from p'] })).toThrow(expect.objectContaining({ code: 'HISTORY_MIGRATION' }));
    const { db, version } = openDatabase({ file, migrations: [v1] });
    expect(version).toBe(1);
    expect(db.prepare('select count(*) n from p').get().n).toBe(1);
    db.close();
  });
});
