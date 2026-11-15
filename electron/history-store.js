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
const LEGS = new Set(['speaker', 'participant']);
const INPUTS = new Set(['microphone', 'system', 'app', 'tab']);
const SEGMENT_SIDES = new Set(['source', 'translation']);
const SENTENCE_SIDES = new Set(['mine', 'other']);
const TRACKS = new Set(['microphone', 'other']);
const TIME_KINDS = new Set(['given', 'spread', 'estimated']);
const TEXT_KINDS = new Set(['original', 'translation']);
const ORIGIN_KINDS = new Set(['live', 'file']);

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
const isOptionalString = (v) => v === undefined || v === null || isString(v);

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

  function openRecordOrFail(id) {
    const r = recordOrFail(id);
    if (r.state !== 'open') fail('RECORD_CLOSED', `Record ${id} is closed`);
    return r;
  }

  function checkSegment(g) {
    if (!isPlainObject(g) || !isString(g.id) || !isInt(g.ref) || !SEGMENT_SIDES.has(g.side) || !isString(g.text)
      || typeof g.final !== 'boolean' || !isInt(g.openedAt) || !Array.isArray(g.marks)
      || !isOptionalString(g.language) || !isOptionalString(g.person) || !isOptionalString(g.origin)) {
      fail('BAD_INPUT', 'A segment needs id, ref, side, text, final, openedAt and marks');
    }
    if (g.timing !== undefined && g.timing !== null && (!isPlainObject(g.timing) || !isInt(g.timing.startMs) || !isInt(g.timing.endMs))) {
      fail('BAD_INPUT', 'A segment timing needs startMs and endMs');
    }
  }

  function segmentOf(g) {
    return {
      id: g.id,
      ref: g.ref,
      side: g.side,
      text: g.text,
      final: g.final === 1,
      openedAt: g.opened_at,
      marks: JSON.parse(g.marks),
      ...(g.start_ms !== null && g.end_ms !== null ? { timing: { startMs: g.start_ms, endMs: g.end_ms } } : {}),
      ...(g.language !== null ? { language: g.language } : {}),
      ...(g.person !== null ? { person: g.person } : {}),
      ...(g.origin !== null ? { origin: g.origin } : {}),
      speech: [],
    };
  }

  function transcriptOrFail(transcriptId) {
    const t = isInt(transcriptId)
      ? one('select t.id, t.record_id, r.state from transcripts t join records r on r.id = t.record_id where t.id = ?', transcriptId)
      : undefined;
    if (!t) fail('NO_TRANSCRIPT', `No transcript ${transcriptId}`);
    return t;
  }

  function checkSentence(x) {
    if (!isPlainObject(x) || !isInt(x.n) || !SENTENCE_SIDES.has(x.side) || typeof x.sideCertain !== 'boolean' || !TRACKS.has(x.track)
      || !isString(x.speaker) || !isInt(x.startMs) || !isInt(x.endMs) || !isString(x.text) || !TIME_KINDS.has(x.timeKind)
      || !isOptionalString(x.segmentId) || !isOptionalString(x.language)) {
      fail('BAD_INPUT', 'A sentence needs n, side, sideCertain, track, speaker, startMs, endMs, text and timeKind');
    }
  }

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

    putLeg({ recordId, leg, languages, input = null, inputName = null, inputId = null, translated = true, spoken = false } = {}) {
      openRecordOrFail(recordId);
      if (!LEGS.has(leg)) fail('BAD_INPUT', 'leg must be speaker or participant');
      if (!isPlainObject(languages) || !isString(languages.source) || !isString(languages.target)) fail('BAD_INPUT', 'languages needs source and target');
      if (input !== null && !INPUTS.has(input)) fail('BAD_INPUT', 'input must be microphone, system, app or tab');
      if (!isOptionalString(inputName) || !isOptionalString(inputId)) fail('BAD_INPUT', 'inputName and inputId are strings');
      if (typeof translated !== 'boolean' || typeof spoken !== 'boolean') fail('BAD_INPUT', 'translated and spoken are booleans');
      run(
        `insert or replace into legs (record_id, leg, source_language, target_language, input, input_name, input_id, translated, spoken)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        recordId, leg, languages.source, languages.target, input, inputName ?? null, inputId ?? null, translated ? 1 : 0, spoken ? 1 : 0,
      );
    },

    putSegments({ recordId, leg, segments } = {}) {
      openRecordOrFail(recordId);
      if (!LEGS.has(leg)) fail('BAD_INPUT', 'leg must be speaker or participant');
      if (!Array.isArray(segments)) fail('BAD_INPUT', 'segments must be an array');
      segments.forEach(checkSegment);
      transaction(db, () => {
        for (const g of segments) {
          // A segment keeps the place it had when it first arrived; a later arrival replaces what it says.
          const known = one('select position from segments where record_id = ? and id = ?', recordId, g.id);
          const position = known ? known.position
            : (one('select coalesce(max(position) + 1, 0) as next from segments where record_id = ? and leg = ?', recordId, leg).next);
          run(
            `insert or replace into segments (record_id, id, leg, position, ref, side, text, final, opened_at, start_ms, end_ms, language, person, origin, marks)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            recordId, g.id, leg, position, g.ref, g.side, g.text, g.final ? 1 : 0, g.openedAt,
            g.timing ? g.timing.startMs : null, g.timing ? g.timing.endMs : null,
            g.language ?? null, g.person ?? null, g.origin ?? null, JSON.stringify(g.marks),
          );
        }
      });
    },

    putNotices({ recordId, leg, notices } = {}) {
      openRecordOrFail(recordId);
      if (!LEGS.has(leg)) fail('BAD_INPUT', 'leg must be speaker or participant');
      if (!Array.isArray(notices) || notices.some((n) => !isPlainObject(n) || !isString(n.id) || !isInt(n.at))) {
        fail('BAD_INPUT', 'notices must be notices with id and at');
      }
      transaction(db, () => {
        for (const n of notices) {
          run('insert or replace into notices (record_id, leg, id, at, body) values (?, ?, ?, ?, ?)', recordId, leg, n.id, n.at, JSON.stringify(n));
        }
      });
    },

    getLegs(recordId) {
      return all("select * from legs where record_id = ? order by leg = 'participant'", recordId).map((l) => ({
        leg: l.leg,
        session: recordId,
        languages: { source: l.source_language, target: l.target_language },
        segments: all('select * from segments where record_id = ? and leg = ? order by position', recordId, l.leg).map(segmentOf),
        notices: all('select body from notices where record_id = ? and leg = ? order by at, id', recordId, l.leg).map((n) => JSON.parse(n.body)),
      }));
    },

    createTranscript({ recordId, origin, textKind = 'original' } = {}) {
      recordOrFail(recordId);
      if (!isPlainObject(origin) || !isString(origin.service) || !ORIGIN_KINDS.has(origin.kind)) fail('BAD_INPUT', 'origin needs service and kind (live or file)');
      if (!TEXT_KINDS.has(textKind)) fail('BAD_INPUT', 'textKind must be original or translation');
      const { lastInsertRowid } = run(
        'insert into transcripts (record_id, origin, text_kind, created_at) values (?, ?, ?, ?)',
        recordId, JSON.stringify(origin), textKind, now(),
      );
      return Number(lastInsertRowid);
    },

    appendSentences({ transcriptId, sentences } = {}) {
      transcriptOrFail(transcriptId);
      if (!Array.isArray(sentences)) fail('BAD_INPUT', 'sentences must be an array');
      sentences.forEach(checkSentence);
      return transaction(db, () => {
        let added = 0;
        for (const x of sentences) {
          // A sentence's number, side, track and times never change once stored: the same arrival is skipped,
          // a different one is refused, and nothing of the call is kept.
          const known = one('select side, track, start_ms, end_ms from sentences where transcript_id = ? and n = ?', transcriptId, x.n);
          if (known) {
            if (known.side !== x.side || known.track !== x.track || known.start_ms !== x.startMs || known.end_ms !== x.endMs) {
              fail('SENTENCE_CONFLICT', `Sentence ${x.n} is already stored with another side, track or time`);
            }
            continue;
          }
          run(
            `insert into sentences (transcript_id, n, segment_id, side, side_certain, track, speaker, start_ms, end_ms, text, language, time_kind)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            transcriptId, x.n, x.segmentId ?? null, x.side, x.sideCertain ? 1 : 0, x.track, x.speaker, x.startMs, x.endMs, x.text, x.language ?? null, x.timeKind,
          );
          added += 1;
        }
        return { added };
      });
    },

    reviseSentences({ transcriptId, revisions } = {}) {
      const t = transcriptOrFail(transcriptId);
      if (t.state !== 'open') fail('RECORD_CLOSED', `Record ${t.record_id} is closed`);
      if (!Array.isArray(revisions) || revisions.some((v) => !isPlainObject(v) || !isInt(v.n) || !isString(v.text))) {
        fail('BAD_INPUT', 'revisions must be { n, text }');
      }
      transaction(db, () => {
        for (const v of revisions) {
          const { changes } = run('update sentences set text = ? where transcript_id = ? and n = ?', v.text, transcriptId, v.n);
          if (Number(changes) === 0) fail('NO_SENTENCE', `No sentence ${v.n}`);
        }
      });
    },

    getSentences({ transcriptId } = {}) {
      transcriptOrFail(transcriptId);
      return all(
        `select s.*, p.name as speaker_name from sentences s
         left join speakers p on p.transcript_id = s.transcript_id and p.side = s.side and p.speaker = coalesce(s.speaker_by_user, s.speaker)
         where s.transcript_id = ? order by s.start_ms, s.side = 'other', s.n`,
        transcriptId,
      ).map((x) => ({
        n: x.n,
        segmentId: x.segment_id,
        side: x.side,
        sideCertain: x.side_certain === 1,
        track: x.track,
        speaker: x.speaker,
        speakerByUser: x.speaker_by_user,
        speakerName: x.speaker_name,
        startMs: x.start_ms,
        endMs: x.end_ms,
        text: x.text,
        language: x.language,
        timeKind: x.time_kind,
      }));
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
