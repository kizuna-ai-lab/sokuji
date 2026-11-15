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
const BIN_DAYS = 30;
const DAY_MS = 86_400_000;
const LEGS = new Set(['speaker', 'participant']);
const INPUTS = new Set(['microphone', 'system', 'app', 'tab']);
const SEGMENT_SIDES = new Set(['source', 'translation']);
const SENTENCE_SIDES = new Set(['mine', 'other']);
const TRACKS = new Set(['microphone', 'other']);
const TIME_KINDS = new Set(['given', 'spread', 'estimated']);
const TEXT_KINDS = new Set(['original', 'translation']);
const ORIGIN_KINDS = new Set(['live', 'file']);
const NOTES_STATES = new Set(['complete', 'failed', 'cancelled']);
const WRITERS = new Set(['sokuji', 'service']);

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
const isIdList = (v) => Array.isArray(v) && v.every(isString);
/** A file name inside a record's folder: no separator, not `.` or `..`. */
const isFileName = (v) => isString(v) && v !== '' && v !== '.' && v !== '..' && !/[\\/]/.test(v);
const sizeOf = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };

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

/** A notes body: { title, overview: { text, format }, topics, points, names }. */
function isNotesBody(b) {
  return isPlainObject(b) && isString(b.title) && isPlainObject(b.overview) && isString(b.overview.text)
    && (b.overview.format === 'plain' || b.overview.format === 'markdown')
    && Array.isArray(b.topics) && Array.isArray(b.points) && Array.isArray(b.names);
}

/** What search reads of a notes body: the title, the overview, each topic's title and summary, each point. */
function notesSearchText(b) {
  const parts = [b.title, b.overview.text];
  for (const topic of b.topics) {
    if (isPlainObject(topic)) parts.push(topic.title, topic.summary);
  }
  for (const point of b.points) {
    if (isPlainObject(point)) parts.push(point.text);
  }
  return parts.filter(isString).join('\n');
}

/** A LIKE pattern matching `query` literally anywhere: `\\`, `%` and `_` stand for themselves. */
const likeAnywhere = (query) => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

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
        textBytes: one(
          `select
             (select coalesce(sum(length(cast(text as blob))), 0) from segments where record_id = ?1)
           + (select coalesce(sum(length(cast(s.text as blob))), 0) from sentences s join transcripts t on t.id = s.transcript_id where t.record_id = ?1)
           + (select coalesce(sum(length(cast(body as blob))), 0) from notes where record_id = ?1) as bytes`,
          id,
        ).bytes,
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

    renameSpeaker({ transcriptId, side, speaker, name } = {}) {
      transcriptOrFail(transcriptId);
      if (!SENTENCE_SIDES.has(side) || !isString(speaker) || !isString(name)) fail('BAD_INPUT', 'A rename needs side, speaker and name');
      const trimmed = name.trim();
      if (trimmed) run('insert or replace into speakers (transcript_id, side, speaker, name) values (?, ?, ?, ?)', transcriptId, side, speaker, trimmed);
      else run('delete from speakers where transcript_id = ? and side = ? and speaker = ?', transcriptId, side, speaker);
    },

    reassignSentence({ transcriptId, n, speaker } = {}) {
      transcriptOrFail(transcriptId);
      if (!isInt(n) || !(speaker === null || isString(speaker))) fail('BAD_INPUT', 'A reassignment needs n and a speaker or null');
      const { changes } = run('update sentences set speaker_by_user = ? where transcript_id = ? and n = ?', speaker, transcriptId, n);
      if (Number(changes) === 0) fail('NO_SENTENCE', `No sentence ${n}`);
    },

    getSpeakers({ transcriptId } = {}) {
      transcriptOrFail(transcriptId);
      return all(
        `with effective as (select side, coalesce(speaker_by_user, speaker) as speaker from sentences where transcript_id = ?1),
         known as (select side, speaker from effective union select side, speaker from speakers where transcript_id = ?1)
         select k.side, k.speaker, p.name, (select count(*) from effective e where e.side = k.side and e.speaker = k.speaker) as sentence_count
         from known k left join speakers p on p.transcript_id = ?1 and p.side = k.side and p.speaker = k.speaker
         order by k.side = 'other', k.speaker`,
        transcriptId,
      ).map((x) => ({ side: x.side, speaker: x.speaker, name: x.name, sentences: x.sentence_count }));
    },

    saveNotes({ recordId, transcriptId, writtenBy, language, state, failure = null, requestIds = [], body = null } = {}) {
      const r = recordOrFail(recordId);
      if (!isPlainObject(writtenBy) || !WRITERS.has(writtenBy.kind) || !isString(language) || !NOTES_STATES.has(state)
        || !isOptionalString(failure) || !Array.isArray(requestIds) || !requestIds.every(isString)) {
        fail('BAD_NOTES', 'Notes need writtenBy, language, state and request ids');
      }
      if (body !== null && !isNotesBody(body)) fail('BAD_NOTES', 'A notes body needs title, overview, topics, points and names');
      if (state === 'complete' && body === null) fail('BAD_NOTES', 'Complete notes need a body');
      if (transcriptId !== null && transcriptId !== undefined) {
        const t = isInt(transcriptId) ? one('select record_id from transcripts where id = ?', transcriptId) : undefined;
        if (!t || t.record_id !== recordId) fail('TRANSCRIPT_MISMATCH', `Transcript ${transcriptId} is not of record ${recordId}`);
      }
      return transaction(db, () => {
        const { lastInsertRowid } = run(
          `insert into notes (record_id, transcript_id, written_by, language, created_at, state, failure, request_ids, body, search_text)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          recordId, transcriptId ?? null, JSON.stringify(writtenBy), language, now(), state, failure ?? null,
          JSON.stringify(requestIds), body === null ? null : JSON.stringify(body), body === null ? null : notesSearchText(body),
        );
        // A complete version titles the record unless the user named it.
        if (state === 'complete' && r.title_by_user === 0 && body.title.trim()) {
          run('update records set title = ? where id = ?', body.title.trim(), recordId);
        }
        return Number(lastInsertRowid);
      });
    },

    listNotes({ recordId } = {}) {
      return all('select id, transcript_id, written_by, language, created_at, state, failure from notes where record_id = ? order by id desc', recordId)
        .map((n) => ({
          id: n.id, transcriptId: n.transcript_id, writtenBy: JSON.parse(n.written_by), language: n.language,
          createdAt: n.created_at, state: n.state, failure: n.failure,
        }));
    },

    getNotes({ id } = {}) {
      const n = isInt(id) ? one('select * from notes where id = ?', id) : undefined;
      if (!n) return null;
      return {
        id: n.id, recordId: n.record_id, transcriptId: n.transcript_id, writtenBy: JSON.parse(n.written_by), language: n.language,
        createdAt: n.created_at, state: n.state, failure: n.failure, requestIds: JSON.parse(n.request_ids),
        body: n.body === null ? null : JSON.parse(n.body),
      };
    },

    search({ query, limit = 50 } = {}) {
      if (!isString(query)) fail('BAD_INPUT', 'query must be a string');
      if (!isInt(limit) || limit < 1) fail('BAD_INPUT', 'limit must be a positive integer');
      const text = query.trim();
      if (!text) return [];
      const pattern = likeAnywhere(text);
      const found = new Map();
      const entry = (id) => {
        if (!found.has(id)) found.set(id, { sentences: [], translations: [], notes: [], title: false });
        return found.get(id);
      };
      for (const x of all(
        `select t.record_id, t.id as transcript_id, t.text_kind, s.n, s.text, s.start_ms, s.segment_id
         from sentences s join transcripts t on t.id = s.transcript_id join records r on r.id = t.record_id
         where r.binned_at is null and s.text like ? escape '\\'`, pattern,
      )) entry(x.record_id).sentences.push(x);
      for (const g of all(
        `select g.record_id, g.id, g.text, g.opened_at, g.position from segments g join records r on r.id = g.record_id
         where r.binned_at is null and g.side = 'translation' and g.text like ? escape '\\'`, pattern,
      )) entry(g.record_id).translations.push(g);
      for (const n of all(
        `select n.record_id, n.id from notes n join records r on r.id = n.record_id
         where r.binned_at is null and n.search_text like ? escape '\\'`, pattern,
      )) entry(n.record_id).notes.push(n);
      for (const r of all("select id from records where binned_at is null and title like ? escape '\\'", pattern)) entry(r.id).title = true;

      const results = [];
      for (const [recordId, m] of found) {
        // Sentences: those of the newest transcript that matches; a translation segment one of them was cut from is that sentence.
        const newest = m.sentences.reduce((max, x) => Math.max(max, x.transcript_id), -1);
        const sentences = m.sentences.filter((x) => x.transcript_id === newest)
          .sort((a, b) => a.start_ms - b.start_ms || a.n - b.n);
        const cutFrom = new Set(m.sentences.filter((x) => x.text_kind === 'translation' && x.segment_id).map((x) => x.segment_id));
        const translations = m.translations.filter((g) => !cutFrom.has(g.id)).sort((a, b) => a.opened_at - b.opened_at || a.position - b.position);
        const notes = [...m.notes].sort((a, b) => b.id - a.id);
        const hits = sentences.length + translations.length + notes.length + (m.title ? 1 : 0);
        if (hits === 0) continue;
        const first = sentences.length > 0 ? { kind: 'sentence', transcriptId: sentences[0].transcript_id, n: sentences[0].n, text: sentences[0].text }
          : translations.length > 0 ? { kind: 'translation', segmentId: translations[0].id, text: translations[0].text }
          : notes.length > 0 ? { kind: 'notes', notesId: notes[0].id }
          : { kind: 'title' };
        const r = one('select title, started_at from records where id = ?', recordId);
        results.push({ recordId, title: r.title, startedAt: r.started_at, hits, first });
      }
      return results.sort((a, b) => b.startedAt - a.startedAt || (a.recordId < b.recordId ? 1 : -1)).slice(0, limit);
    },

    binRecords({ ids } = {}) {
      if (!isIdList(ids)) fail('BAD_INPUT', 'ids must be a list of record ids');
      const at = now();
      let changed = 0;
      transaction(db, () => {
        // Only a closed record goes to the bin: a running session's folder is never purged under it.
        for (const id of ids) changed += Number(run("update records set binned_at = ? where id = ? and binned_at is null and state = 'closed'", at, id).changes);
      });
      return { changed };
    },

    restoreRecords({ ids } = {}) {
      if (!isIdList(ids)) fail('BAD_INPUT', 'ids must be a list of record ids');
      let changed = 0;
      transaction(db, () => {
        for (const id of ids) changed += Number(run('update records set binned_at = null where id = ? and binned_at is not null', id).changes);
      });
      return { changed };
    },

    purgeRecords({ ids } = {}) {
      if (!isIdList(ids)) fail('BAD_INPUT', 'ids must be a list of record ids');
      const purged = [];
      for (const id of ids) {
        // The id comes back from the database: a path is never taken from the caller.
        const r = one('select id from records where id = ? and binned_at is not null', id);
        if (!r) continue;
        dropRecord(r.id);
        purged.push(r.id);
      }
      return { purged };
    },

    purgeExpired() {
      const ids = all('select id from records where binned_at is not null and binned_at <= ? order by binned_at, id', now() - BIN_DAYS * DAY_MS).map((r) => r.id);
      return store.purgeRecords({ ids });
    },

    putTrack({ recordId, source, file, format, durationMs, bytes, offsetMs } = {}) {
      recordOrFail(recordId);
      if (!isString(source) || !source || !isFileName(file) || !isString(format) || !isInt(durationMs) || !isInt(bytes) || !isInt(offsetMs)) {
        fail('BAD_INPUT', 'A track needs source, a file name in its record folder, format, durationMs, bytes and offsetMs');
      }
      run(
        `insert or replace into tracks (record_id, source, file, format, duration_ms, bytes, offset_ms, gone_at)
         values (?, ?, ?, ?, ?, ?, ?, null)`,
        recordId, source, file, format, durationMs, bytes, offsetMs,
      );
    },

    dropTrack({ recordId, source } = {}) {
      const k = one('select record_id, source, file from tracks where record_id = ? and source = ?', recordId, source);
      if (!k) fail('NO_TRACK', `No ${source} track in record ${recordId}`);
      fs.rmSync(path.join(folderOf(k.record_id), k.file), { force: true });
      run('update tracks set gone_at = ? where record_id = ? and source = ?', now(), k.record_id, k.source);
    },

    usage() {
      const file = path.join(dir, 'history.db');
      return {
        dbBytes: sizeOf(file) + sizeOf(`${file}-wal`),
        audioBytes: one('select coalesce(sum(bytes), 0) as b from tracks where gone_at is null').b,
        records: one('select count(*) as c from records').c,
        binned: one('select count(*) as c from records where binned_at is not null').c,
      };
    },

    reconcile() {
      const removedEmpty = [];
      const strays = [];
      const known = new Set(all('select id from records').map((r) => r.id));
      const records = path.join(dir, 'records');
      for (const d of fs.readdirSync(records, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
        if (known.has(d)) continue;
        // A folder left by an interrupted purge or a crash: removed when empty; files in it are never deleted here.
        if (fs.readdirSync(path.join(records, d)).length === 0) {
          fs.rmdirSync(path.join(records, d));
          removedEmpty.push(d);
        } else {
          strays.push(d);
        }
      }
      let tracksGone = 0;
      const at = now();
      for (const k of all('select record_id, source, file from tracks where gone_at is null')) {
        if (fs.existsSync(path.join(folderOf(k.record_id), k.file))) continue;
        run('update tracks set gone_at = ? where record_id = ? and source = ?', at, k.record_id, k.source);
        tracksGone += 1;
      }
      return { removedEmpty, strays, tracksGone };
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

module.exports = { openHistory, HistoryError, ID_PATTERN, BIN_DAYS };
