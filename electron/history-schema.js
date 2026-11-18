// electron/history-schema.js
//
// The History database's schema, as ordered migrations: MIGRATIONS[i] takes the file from version i to i + 1
// (`PRAGMA user_version`). A migration is never edited once released; a change is a new entry.
'use strict';

const V1 = `
create table records (
  id text primary key,
  started_at integer not null,
  ended_at integer,
  state text not null check (state in ('open', 'closed')),
  mode text not null,
  my_language text not null,
  target_language text not null,
  services text not null,
  app_version text not null,
  title text,
  title_by_user integer not null default 0 check (title_by_user in (0, 1)),
  binned_at integer
) strict;

create table tracks (
  record_id text not null references records(id) on delete cascade,
  source text not null,
  file text not null,
  format text not null,
  duration_ms integer not null,
  bytes integer not null,
  offset_ms integer not null,
  gone_at integer,
  primary key (record_id, source)
) strict;

create table legs (
  record_id text not null references records(id) on delete cascade,
  leg text not null check (leg in ('speaker', 'participant')),
  source_language text not null,
  target_language text not null,
  input text check (input is null or input in ('microphone', 'system', 'app', 'tab')),
  input_name text,
  input_id text,
  translated integer not null check (translated in (0, 1)),
  spoken integer not null check (spoken in (0, 1)),
  primary key (record_id, leg)
) strict;

create table segments (
  record_id text not null references records(id) on delete cascade,
  id text not null,
  leg text not null check (leg in ('speaker', 'participant')),
  position integer not null,
  ref integer not null,
  side text not null check (side in ('source', 'translation')),
  text text not null,
  final integer not null check (final in (0, 1)),
  opened_at integer not null,
  start_ms integer,
  end_ms integer,
  language text,
  person text,
  origin text,
  marks text not null,
  primary key (record_id, id)
) strict;

create table notices (
  record_id text not null references records(id) on delete cascade,
  leg text not null check (leg in ('speaker', 'participant')),
  id text not null,
  at integer not null,
  body text not null,
  primary key (record_id, leg, id)
) strict;

create table transcripts (
  id integer primary key autoincrement,
  record_id text not null references records(id) on delete cascade,
  origin text not null,
  text_kind text not null check (text_kind in ('original', 'translation')),
  created_at integer not null
) strict;

create table sentences (
  transcript_id integer not null references transcripts(id) on delete cascade,
  n integer not null,
  segment_id text,
  side text not null check (side in ('mine', 'other')),
  side_certain integer not null check (side_certain in (0, 1)),
  track text not null check (track in ('microphone', 'other')),
  speaker text not null,
  speaker_by_user text,
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  language text,
  time_kind text not null check (time_kind in ('given', 'spread', 'estimated')),
  -- A file transcript's translation of what the service translated starting in this sentence (a clause or a sentence);
  -- null where none began here, and on a session's transcript, whose translation is the conversation's (segments).
  translation text,
  primary key (transcript_id, n)
) strict;

create table speakers (
  transcript_id integer not null references transcripts(id) on delete cascade,
  side text not null check (side in ('mine', 'other')),
  speaker text not null,
  name text not null,
  primary key (transcript_id, side, speaker)
) strict;

create table notes (
  id integer primary key autoincrement,
  record_id text not null references records(id) on delete cascade,
  transcript_id integer references transcripts(id) on delete set null,
  written_by text not null,
  language text not null,
  created_at integer not null,
  state text not null check (state in ('complete', 'failed', 'cancelled')),
  failure text,
  request_ids text not null,
  body text,
  search_text text
) strict;

create index records_list on records (binned_at, started_at desc);
create index segments_order on segments (record_id, leg, position);
create index sentences_time on sentences (transcript_id, start_ms);
create index transcripts_record on transcripts (record_id);
create index notes_record on notes (record_id);
create index notes_transcript on notes (transcript_id);
`;

const MIGRATIONS = [V1];
const SCHEMA_VERSION = MIGRATIONS.length;

module.exports = { MIGRATIONS, SCHEMA_VERSION };
