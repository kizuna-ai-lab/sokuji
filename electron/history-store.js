// electron/history-store.js
//
// Everything History does with text, over one SQLite file: records, the conversation as the app holds it,
// sentences and speakers, notes versions, search, the bin and the space used. No Electron import: tested
// against real temporary folders. Every method is synchronous and throws a `HistoryError` with a `code` on
// bad input; the IPC layer turns those into answers.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, transaction } = require('./history-db.js');

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

class HistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HistoryError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new HistoryError(code, message); };
const isString = (v) => typeof v === 'string';
const isInt = (v) => Number.isSafeInteger(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A record has content when one of its transcripts has a sentence or one of its segments has text that is not blank. */
const HAS_CONTENT = `(
  exists (select 1 from sentences s join transcripts t on t.id = s.transcript_id where t.record_id = r.id)
  or exists (select 1 from segments g where g.record_id = r.id and trim(g.text) <> '')
)`;

const ROW_COLUMNS = `
  r.id, r.started_at, r.ended_at, r.state, r.mode, r.my_language, r.target_language, r.title, r.title_by_user, r.binned_at,
  (select count(*) from sentences s where s.transcript_id = (select max(t.id) from transcripts t where t.record_id = r.id)) as sentence_count,
  exists (select 1 from tracks k where k.record_id = r.id and k.gone_at is null) as has_recording,
  (select count(*) from notes n where n.record_id = r.id) as notes_versions,
  (select coalesce(sum(k.bytes), 0) from tracks k where k.record_id = r.id and k.gone_at is null) as audio_bytes`;

function rowOf(r) {
  return {
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    state: r.state,
    mode: r.mode,
    myLanguage: r.my_language,
    targetLanguage: r.target_language,
    title: r.title,
    titleByUser: r.title_by_user === 1,
    binnedAt: r.binned_at,
    sentences: r.sentence_count,
    hasRecording: r.has_recording === 1,
    notesVersions: r.notes_versions,
    audioBytes: r.audio_bytes,
  };
}

/**
 * Opens the store in `dir` (created with its `records` folder when missing), its text in `dir/history.db`.
 * `now` gives wall-clock epoch milliseconds.
 */
function openHistory({ dir, now = () => Date.now() }) {
  fs.mkdirSync(path.join(dir, 'records'), { recursive: true });
  const { db } = openDatabase({ file: path.join(dir, 'history.db') });

  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);

  const folderOf = (id) => path.join(dir, 'records', id);
  const removeFolder = (id) => fs.rmSync(folderOf(id), { recursive: true, force: true });

  function recordOrFail(id) {
    const r = one('select id, state, started_at, title_by_user from records where id = ?', id);
    if (!r) fail('NO_RECORD', `No record ${id}`);
    return r;
  }

  const hasContent = (id) => one(`select ${HAS_CONTENT} as yes from records r where r.id = ?`, id)?.yes === 1;

  /** Deletes a record's rows (the rest cascade) and its folder. */
  function dropRecord(id) {
    run('delete from records where id = ?', id);
    removeFolder(id);
  }

  const store = {
    close() {
      db.close();
    },

    openRecord({ id, startedAt, mode, myLanguage, targetLanguage, services, appVersion } = {}) {
      if (!isString(id) || !ID_PATTERN.test(id)) fail('BAD_ID', 'A record id is 8 to 64 letters, digits or hyphens');
      if (!isInt(startedAt) || !isString(mode) || !isString(myLanguage) || !isString(targetLanguage) || !isString(appVersion)) {
        fail('BAD_INPUT', 'A record needs startedAt, mode, myLanguage, targetLanguage and appVersion');
      }
      if (!isPlainObject(services) || !isString(services.provider) || !isPlainObject(services.models)) {
        fail('BAD_INPUT', 'A record needs services { provider, models }');
      }
      if (one('select 1 as yes from records where id = ?', id)) fail('RECORD_EXISTS', `Record ${id} already exists`);
      run(
        `insert into records (id, started_at, state, mode, my_language, target_language, services, app_version)
         values (?, ?, 'open', ?, ?, ?, ?, ?)`,
        id, startedAt, mode, myLanguage, targetLanguage, JSON.stringify(services), appVersion,
      );
    },

    closeRecord({ id, endedAt } = {}) {
      const r = recordOrFail(id);
      if (!isInt(endedAt)) fail('BAD_INPUT', 'endedAt must be an integer');
      if (r.state === 'closed') return { kept: true };
      if (!hasContent(id)) {
        dropRecord(id);
        return { kept: false };
      }
      run("update records set state = 'closed', ended_at = ? where id = ?", endedAt, id);
      return { kept: true };
    },

    recoverOpenRecords() {
      const closed = [];
      const dropped = [];
      for (const r of all("select id, started_at from records where state = 'open' order by started_at, id")) {
        if (!hasContent(r.id)) {
          dropRecord(r.id);
          dropped.push(r.id);
          continue;
        }
        const lastSentence = one(
          'select max(s.end_ms) as at from sentences s join transcripts t on t.id = s.transcript_id where t.record_id = ?', r.id,
        ).at;
        const endedAt = lastSentence !== null
          ? r.started_at + lastSentence
          : one('select max(opened_at) as at from segments where record_id = ?', r.id).at;
        run("update records set state = 'closed', ended_at = ? where id = ?", endedAt, r.id);
        closed.push(r.id);
      }
      return { closed, dropped };
    },

    getRecord(id) {
      const r = one(`select ${ROW_COLUMNS}, r.services, r.app_version from records r where r.id = ?`, id);
      if (!r) return null;
      return {
        ...rowOf(r),
        services: JSON.parse(r.services),
        appVersion: r.app_version,
        legs: all('select * from legs where record_id = ? order by leg = \'participant\', leg', id).map((l) => ({
          leg: l.leg,
          languages: { source: l.source_language, target: l.target_language },
          input: l.input,
          inputName: l.input_name,
          inputId: l.input_id,
          translated: l.translated === 1,
          spoken: l.spoken === 1,
        })),
        tracks: all('select * from tracks where record_id = ? order by source', id).map((k) => ({
          source: k.source,
          file: k.file,
          format: k.format,
          durationMs: k.duration_ms,
          bytes: k.bytes,
          offsetMs: k.offset_ms,
          goneAt: k.gone_at,
        })),
        transcripts: all(
          `select t.id, t.origin, t.text_kind, t.created_at, (select count(*) from sentences s where s.transcript_id = t.id) as sentence_count
           from transcripts t where t.record_id = ? order by t.id`, id,
        ).map((t) => ({ id: t.id, origin: JSON.parse(t.origin), textKind: t.text_kind, createdAt: t.created_at, sentences: t.sentence_count })),
        notes: all('select id, transcript_id, language, created_at, state from notes where record_id = ? order by id desc', id).map((n) => ({
          id: n.id, transcriptId: n.transcript_id, language: n.language, createdAt: n.created_at, state: n.state,
        })),
      };
    },

    listRecords({ binned = false, limit = 200, before = null } = {}) {
      if (!isInt(limit) || limit < 1) fail('BAD_INPUT', 'limit must be a positive integer');
      if (before !== null && !isInt(before)) fail('BAD_INPUT', 'before must be an integer or null');
      return all(
        `select ${ROW_COLUMNS} from records r
         where (r.binned_at is not null) = ? and (? is null or r.started_at < ?)
         order by r.started_at desc, r.id desc limit ?`,
        binned ? 1 : 0, before, before, limit,
      ).map(rowOf);
    },

    renameRecord({ id, title } = {}) {
      recordOrFail(id);
      if (!isString(title)) fail('BAD_INPUT', 'title must be a string');
      const trimmed = title.trim();
      if (trimmed) run('update records set title = ?, title_by_user = 1 where id = ?', trimmed, id);
      else run('update records set title = null, title_by_user = 0 where id = ?', id);
    },

    recordDir(id) {
      if (!isString(id) || !ID_PATTERN.test(id)) fail('BAD_ID', 'A record id is 8 to 64 letters, digits or hyphens');
      const folder = folderOf(id);
      fs.mkdirSync(folder, { recursive: true });
      return folder;
    },
  };

  return store;
}

module.exports = { openHistory, HistoryError, ID_PATTERN };
