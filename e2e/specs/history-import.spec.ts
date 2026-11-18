import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { baseStorage, REPO } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';
import { addTranscriptionKey, fakeTranscription, transcriptionLineUp } from '../support/transcription';

const FIXTURES = path.join(REPO, 'e2e/fixtures/audio');
/** The word list a session sends with its words; a file's transcription sends it too. */
const WORDS = {
  'settings.words': JSON.stringify({ version: 1, entries: [{ written: 'Sokuji' }, { written: 'Kizuna', translation: '絆' }] }),
  'settings.sessionBackground': 'A weekly team meeting.',
};
/** The app with the transcription service faked, its key put in, and History open. */
async function readyToImport(launchApp: Parameters<Parameters<typeof test>[2]>[0]['launchApp']) {
  const sokuji = await launchApp({
    fakeServices: true,
    seed: { storage: { ...baseStorage('soniox'), 'settings.lineup': JSON.stringify(transcriptionLineUp), ...WORDS } },
  });
  const transcription = await fakeTranscription(sokuji);
  await addTranscriptionKey(sokuji);
  await sokuji.page.getByRole('button', { name: 'History', exact: true }).click();
  return { sokuji, transcription };
}

/** Every text the import's progress line shows, in order, as it changes. */
async function watchProgress(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { e2eProgress: string[] }).e2eProgress = seen;
    const note = () => {
      const line = document.querySelector('.history-file__line[role="status"] p')?.textContent;
      if (line && seen[seen.length - 1] !== line) seen.push(line);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const progress = (page: Page) => page.evaluate(() => (window as unknown as { e2eProgress: string[] }).e2eProgress);

/** What the import is asked for, by language code: the main language, others it may contain, the translation. */
interface Asked { main?: string; others?: string[]; translateTo?: string }
/** The panel's fields set as `asked` says (the main language English unless said; the rest left as they start). */
async function choose(panel: Locator, asked: Asked) {
  await panel.getByLabel('Main language').selectOption(asked.main ?? 'en');
  for (const code of asked.others ?? []) await panel.getByLabel('Add another language').selectOption(code);
  if (asked.translateTo) await panel.getByLabel('Translate into').selectOption(asked.translateTo);
}
/** The file chosen with "Import a file", its options set, and Start. A bare name is one of the fixtures. */
async function importFile(page: Page, file: string, asked: Asked = {}) {
  await page.locator('input[type="file"][accept="audio/*,video/*"]').setInputFiles(path.isAbsolute(file) ? file : path.join(FIXTURES, file));
  const panel = page.getByRole('dialog', { name: `Import “${path.basename(file)}”` });
  await choose(panel, asked);
  await panel.getByRole('button', { name: 'Start' }).click();
}

const PHASES = [
  'Reading the file', 'Decoding the audio', 'Saving the recording', 'Sending the recording to Soniox',
  'Waiting at Soniox', 'Soniox is transcribing', 'Fetching the transcript', 'Writing the transcript',
];

// An imported file goes through every step in order, and becomes a record like any other: its sentences are there,
// with no side of the conversation given to them, each with its translation, it plays, it is found by a word of
// either, and it exports with its translations. The service is asked for exactly the languages and the translation
// chosen, with the word list, and keeps nothing of it afterwards.
test('a file imports through every step and becomes a record that plays, is found and exports', async ({ launchApp }) => {
  const { sokuji, transcription } = await readyToImport(launchApp);
  const { page, userData, app } = sokuji;
  await watchProgress(page);
  // Held at "transcribing" until seen there, so that the step is not over between two looks at the service.
  await transcription.answerWith({ hold: true });
  await importFile(page, 'sample.wav', { main: 'en', others: ['ja'], translateTo: 'zh' });
  await expect(page.getByText(/^Importing “sample\.wav”: Soniox is transcribing$/)).toBeVisible({ timeout: 30_000 });
  await transcription.release();
  await expect(page.locator('.history-file__line')).toHaveCount(0, { timeout: 30_000 });
  expect(await transcription.options()).toEqual({
    languages: ['en', 'ja'], translateTo: 'zh',
    words: { terms: ['Sokuji', 'Kizuna'], translations: [['Kizuna', '絆']], background: 'A weekly team meeting.' },
  });

  // Each step shown in its place, none out of order; the waits at the service are long enough to be seen for sure.
  const shown = (await progress(page)).map((line) => line.replace(/^Importing “sample\.wav”: /, ''));
  expect(shown.every((step) => PHASES.includes(step))).toBe(true);
  expect(shown.map((step) => PHASES.indexOf(step))).toEqual([...shown.map((step) => PHASES.indexOf(step))].sort((a, b) => a - b));
  for (const step of ['Sending the recording to Soniox', 'Waiting at Soniox', 'Soniox is transcribing']) expect(shown).toContain(step);

  // The record: its sentences, under a speaker and not under "Me" or "Other".
  const row = page.locator('.history-list [data-record]').first();
  await row.locator('.history-row__open').click();
  const transcript = page.locator('.record-page__transcript');
  await expect(transcript.getByText('This is the first sentence of the imported file.')).toBeVisible();
  await expect(transcript.getByText('And this is the second one.')).toBeVisible();
  // The translation under them: the two sentences are one turn (one speaker, no pause), shown as one row.
  await expect(transcript.locator('.record-row__translation')).toHaveText(['这是导入文件的第一句。这是第二句。']);
  await expect(transcript.locator('.record-row__speaker').first()).not.toHaveText(/^(Me|Other)$/);
  // It plays.
  const player = page.getByRole('group', { name: 'Recording' });
  await player.getByRole('button', { name: 'Play' }).click();
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
  await player.getByRole('button', { name: 'Pause' }).click();
  // It is found by a word in it.
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await page.getByRole('searchbox', { name: 'Search History' }).fill('imported');
  await expect(page.locator('.history-list [data-record]')).toHaveCount(1);
  await expect(page.locator('.history-list .history-row__snippet').first()).toContainText('imported file');
  // And by a word of its translation.
  await page.getByRole('searchbox', { name: 'Search History' }).fill('第二句');
  await expect(page.locator('.history-list [data-record]')).toHaveCount(1);
  await expect(page.locator('.history-list .history-row__snippet').first()).toContainText('这是第二句。');
  // It exports, the translations with it.
  await page.getByRole('searchbox', { name: 'Search History' }).fill('');
  await row.locator('.history-row__open').click();
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy the conversation', exact: true }).click();
  let copied = '';
  await expect.poll(async () => (copied = await app.evaluate(({ clipboard }) => clipboard.readText())), { timeout: 5_000 }).not.toBe('');
  for (const text of ['This is the first sentence of the imported file.', '这是导入文件的第一句。', 'And this is the second one.', '这是第二句。']) {
    expect(copied).toContain(text);
  }

  expect(await transcription.kept()).toBe(0);
  expect(await transcription.refused()).toEqual([]);
  expect(sokuji.errors).toEqual([]);
  await sokuji.close();
  const [record] = readHistory(userData);
  expect(record.state).toBe('closed');
  expect(record.sentences).toBe(2);
});

/** The import has ended: its progress line is gone, and no failure is shown in its place. */
async function importEnded(page: Page, file = '') {
  await expect(page.locator('.history-file__line[role="status"]'), file).toHaveCount(0, { timeout: 60_000 });
  const failed = page.locator('.history-file__line[role="alert"]');
  if (await failed.count()) throw new Error(`${file}: the import failed: ${await failed.innerText()}`);
}

/** Each record's id, title, start and the length of its kept recording, in the order they were made; read after the app closed. */
function storedRecords(userData: string) {
  const db = new DatabaseSync(path.join(userData, 'history', 'history.db'), { readOnly: true });
  try {
    return db.prepare(`select r.id, r.title, r.started_at as startedAt,
        (select sum(k.duration_ms) from tracks k where k.record_id = r.id and k.gone_at is null) as recordingMs,
        (select count(*) from transcripts t where t.record_id = r.id) as transcripts
      from records r order by r.rowid`).all() as { id: string; title: string | null; startedAt: number; recordingMs: number | null; transcripts: number }[];
  } finally {
    db.close();
  }
}
const recordFolders = (userData: string) => {
  const dir = path.join(userData, 'history', 'records');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

/** The file formats people bring, each with how long it is (the m4a ones are from another recording). */
const FORMATS = [
  { file: 'sample.wav', seconds: 3.1 }, { file: 'sample.mp3', seconds: 3.1 }, { file: 'sample.flac', seconds: 3.1 },
  { file: 'sample.opus', seconds: 3.1 }, { file: 'sample.mp4', seconds: 3.1 }, { file: 'sample.webm', seconds: 3.1 },
  { file: 'sample-aac.m4a', seconds: 2.3 },
];

// WAV, MP3, FLAC, Ogg Opus, MP4, WebM video and AAC in m4a each import: transcribed, as long as the file (within a
// second), and playing from its start. (ALAC and AC-3: see the test after this one.)
test('the common audio and video formats import, each as long as its file, and play from the start', async ({ launchApp }) => {
  test.setTimeout(8 * 60_000);
  const { sokuji, transcription } = await readyToImport(launchApp);
  const { page, userData } = sokuji;
  const player = page.getByRole('group', { name: 'Recording' });
  for (const { file } of FORMATS) {
    await importFile(page, file);
    await importEnded(page, file);
    // The newest record is the one just imported.
    await page.locator('.history-list [data-record]').first().locator('.history-row__open').click();
    await expect(page.locator('.record-page__transcript').getByText('And this is the second one.'), file).toBeVisible();
    await expect(player.getByLabel('Position'), file).toHaveValue('0');
    await player.getByRole('button', { name: 'Play' }).click();
    const at = () => page.evaluate(() => (document.querySelector('.record-player audio') as HTMLAudioElement).currentTime);
    await expect.poll(at, { message: file, timeout: 5_000 }).toBeGreaterThan(0);
    expect(await at(), file).toBeLessThan(1.5);
    await player.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Back to the list' }).click();
  }
  expect(await transcription.kept()).toBe(0);
  expect(await transcription.refused()).toEqual([]);
  expect(sokuji.errors).toEqual([]);
  await sokuji.close();
  const records = storedRecords(userData);
  expect(records).toHaveLength(FORMATS.length);
  records.forEach((record, i) => {
    expect(record.title, FORMATS[i].file).toBe(FORMATS[i].file.replace(/\.[^.]+$/, ''));
    expect(Math.abs((record.recordingMs ?? 0) - FORMATS[i].seconds * 1000), FORMATS[i].file).toBeLessThanOrEqual(1000);
  });
});

// ALAC (Apple Lossless) and AC-3 (a 5.1 video's sound) are decoded by neither of the page's decoders today, on Linux
// or macOS. Such a file is refused before anything is kept: it says the audio cannot be read and what to convert it
// to, leaves no record or folder, and nothing is sent to the service. (Should either codec be supported one day, it
// moves to the list above.)
test('a file whose sound the app cannot decode is refused, says what to convert it to, and leaves nothing', async ({ launchApp }) => {
  const { sokuji, transcription } = await readyToImport(launchApp);
  const { page, userData } = sokuji;
  const failure = page.locator('.history-file__line[role="alert"]');
  for (const file of ['sample-alac.m4a', 'sample-ac3-5.1.mp4']) {
    await importFile(page, file);
    await expect(failure, file).toContainText('The audio of this file cannot be read. Convert it to AAC or MP3 and import it again.', { timeout: 30_000 });
    await expect(failure, file).not.toContainText('The recording was kept');
    await failure.getByRole('button', { name: 'Got it' }).click();
    await expect(page.locator('.history-list [data-record]'), file).toHaveCount(0);
  }
  expect(await transcription.asked()).toEqual([]);
  expect(sokuji.errors).toEqual([]);
  await sokuji.close();
  expect(recordFolders(userData)).toEqual([]);
});

// An import goes on while the user is elsewhere in the app; back in History its progress is still shown, and it ends.
test('an import goes on away from History, and its progress shows on coming back', async ({ launchApp }) => {
  const { sokuji, transcription } = await readyToImport(launchApp);
  const { page } = sokuji;
  await transcription.answerWith({ hold: true });
  await importFile(page, 'sample.wav');
  const transcribing = page.getByText(/^Importing “sample\.wav”: Soniox is transcribing$/);
  await expect(transcribing).toBeVisible({ timeout: 30_000 });
  // Away from History until the service has been asked again: held, the app's only requests are its looks at the job.
  await page.getByRole('button', { name: 'Back to the session' }).click();
  await expect(page.locator('[data-tour="main-action"]')).toBeVisible();
  const asked = (await transcription.asked()).length;
  await expect.poll(async () => (await transcription.asked()).length, { timeout: 15_000 }).toBeGreaterThan(asked);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(transcribing).toBeVisible();
  await expect(page.locator('.history-list [data-record]')).toHaveCount(1);
  await transcription.release();
  await importEnded(page);
  await page.locator('.history-list [data-record]').first().locator('.history-row__open').click();
  await expect(page.locator('.record-page__transcript').getByText('This is the first sentence of the imported file.')).toBeVisible();
  expect(sokuji.errors).toEqual([]);
});

// A record transcribed again keeps its earlier transcript: the new one is shown, the old one can be chosen, and a
// speaker renamed in the old one is not renamed in the new one.
test('a record transcribed again shows the new transcript, keeps the old one, and carries no name across', async ({ launchApp }) => {
  const { sokuji, transcription } = await readyToImport(launchApp);
  const { page } = sokuji;
  await importFile(page, 'sample.wav', { translateTo: 'zh' });
  await importEnded(page);
  await page.locator('.history-list [data-record]').first().locator('.history-row__open').click();
  const drawer = page.getByRole('complementary', { name: 'Side panel' });
  const transcript = page.locator('.record-page__transcript');
  await drawer.getByRole('button', { name: 'Rename Speaker 1' }).click();
  await drawer.getByRole('textbox', { name: 'Name' }).fill('Mina');
  await page.keyboard.press('Enter');
  await expect(transcript.locator('.record-row__speaker').first()).toHaveText('Mina');

  await transcription.answerWith({ sentences: [{ text: 'A second transcript, made again.', startMs: 300, endMs: 2000, translation: 'もう一度作った文字起こし。' }] });
  await page.locator('.record-page__more > button').click();
  await page.getByRole('menuitem', { name: 'Transcribe again' }).click();
  // It asks what an import asks, starting from what the import was asked for.
  const again = page.getByRole('dialog', { name: 'Transcribe again' });
  await expect(again.getByLabel('Main language')).toHaveValue('en');
  await expect(again.getByLabel('Translate into')).toHaveValue('zh');
  await choose(again, { others: ['fr'], translateTo: 'ja' });
  await again.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(/^Transcribing: /)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.history-file__line[role="status"]')).toHaveCount(0, { timeout: 60_000 });

  // The new one shown, its speaker not renamed; the old one still there to choose, with its name.
  const versions = page.getByLabel('Transcript version');
  await expect(versions.locator('option')).toHaveCount(2);
  await expect(transcript.getByText('A second transcript, made again.')).toBeVisible();
  await expect(transcript.locator('.record-row__translation')).toHaveText(['もう一度作った文字起こし。']);
  expect(await transcription.options()).toMatchObject({ languages: ['en', 'fr'], translateTo: 'ja' });
  await expect(transcript.getByText('This is the first sentence of the imported file.')).toHaveCount(0);
  await expect(transcript.locator('.record-row__speaker').first()).toHaveText('Speaker 1');
  await versions.selectOption({ index: 1 });
  await expect(transcript.getByText('This is the first sentence of the imported file.')).toBeVisible();
  await expect(transcript.locator('.record-row__speaker').first()).toHaveText('Mina');
  expect(await transcription.kept()).toBe(0);
  expect(sokuji.errors).toEqual([]);
});

/** A WAV long enough that reading and saving it take a while: a tone, so that it is not silence. */
function longWav(dir: string, minutes: number) {
  const rate = 16_000;
  const samples = minutes * 60 * rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(8_000 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  const file = path.join(dir, 'long-meeting.wav');
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return file;
}

// Stopped before its recording is saved, an import leaves nothing; stopped or refused at the service once the
// recording is saved, it keeps that recording (to transcribe later) and says so. Either way the service keeps
// nothing, and History's folders and records match.
test('a cancelled or failed import leaves nothing behind but a recording it says it kept', async ({ launchApp }, testInfo) => {
  test.setTimeout(4 * 60_000);
  const { sokuji, transcription } = await readyToImport(launchApp);
  const { page, userData } = sokuji;
  const cancel = page.locator('.history-file__line[role="status"]').getByRole('button', { name: 'Cancel' });
  const failure = page.locator('.history-file__line[role="alert"]');

  // Cancelled while its recording is being saved: gone.
  const long = longWav(testInfo.outputPath(), 20);
  await importFile(page, long);
  await expect(page.getByText(/^Importing “long-meeting\.wav”: Saving the recording$/)).toBeVisible({ timeout: 60_000 });
  await cancel.click();
  await expect(failure).toContainText('Cancelled.', { timeout: 30_000 });
  await expect(failure).not.toContainText('The recording was kept');
  await failure.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.history-list [data-record]')).toHaveCount(0);

  // Cancelled at the service: the recording is kept, and the service deletes what it had.
  await transcription.answerWith({ hold: true });
  await importFile(page, 'sample.wav');
  await expect(page.getByText(/Soniox is transcribing$/)).toBeVisible({ timeout: 30_000 });
  await cancel.click();
  await expect(failure).toContainText('Cancelled.', { timeout: 30_000 });
  await expect(failure).toContainText('The recording was kept. Open the record to transcribe it.');
  await failure.getByRole('button', { name: 'Got it' }).click();

  // Refused by the service, no credit left: the same.
  await transcription.answerWith({ fail: 'no-credit' });
  await importFile(page, 'sample.flac');
  await expect(failure).toContainText('The Soniox account has no credit left.', { timeout: 30_000 });
  await expect(failure).toContainText('The recording was kept. Open the record to transcribe it.');
  await failure.getByRole('button', { name: 'Got it' }).click();

  await expect.poll(() => transcription.kept(), { timeout: 30_000 }).toBe(0);
  expect(await transcription.refused()).toEqual([]);
  await sokuji.close();
  const records = storedRecords(userData);
  expect(records.map((r) => [r.title, r.transcripts])).toEqual([['sample', 0], ['sample', 0]]);
  for (const r of records) expect(r.recordingMs).toBeGreaterThan(2_000);
  expect(recordFolders(userData)).toEqual(records.map((r) => r.id).sort());
});

// Only a transcription service that transcribes files can import one: with any other, the import says so and
// cannot start. (When another service gains file transcription, this is where it shows.)
test('with a transcription service that does not transcribe files, an import cannot start and says why', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: { storage: baseStorage('fake') } });
  const { page } = sokuji;
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('input[type="file"][accept="audio/*,video/*"]').setInputFiles(path.join(FIXTURES, 'sample.wav'));
  const panel = page.getByRole('dialog', { name: 'Import “sample.wav”' });
  await expect(panel).toContainText('Files are transcribed only by Soniox with your own key.');
  await expect(panel.getByRole('button', { name: 'Start' })).toBeDisabled();
  expect(sokuji.errors).toEqual([]);
});
