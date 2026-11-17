import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { baseStorage, mainAction } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

/**
 * The page saves a text export as a download, and Electron asks where with its own Save dialog, which neither
 * Playwright nor `answerSaveDialog` reaches. From here on every download goes to `dir` under its own name, unasked.
 */
async function saveDownloadsTo(app: ElectronApplication, dir: string) {
  await app.evaluate(({ session }, { dir, sep }) => {
    const done: string[] = [];
    (globalThis as { e2eDownloads?: string[] }).e2eDownloads = done;
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSavePath(`${dir}${sep}${item.getFilename()}`);
      item.once('done', (_e, state) => { if (state === 'completed') done.push(item.getFilename()); });
    });
  }, { dir, sep: path.sep });
}

/** The file the next click downloads, once it is complete: its name and its text. */
async function download(app: ElectronApplication, dir: string, click: () => Promise<void>) {
  const before = await app.evaluate(() => (globalThis as { e2eDownloads?: string[] }).e2eDownloads?.length ?? 0);
  await click();
  let name = '';
  await expect.poll(async () => {
    name = await app.evaluate((_electron, n) => (globalThis as { e2eDownloads?: string[] }).e2eDownloads?.[n] ?? '', before);
    return name;
  }, { timeout: 10_000 }).not.toBe('');
  return { name, text: fs.readFileSync(path.join(dir, name), 'utf8') };
}

/** The system's Save dialog answers `to` (null: Cancel), and keeps what it was asked: its title and suggested path. */
async function answerSaveDialogKeepingAsked(app: ElectronApplication, to: string | null) {
  await app.evaluate(({ dialog }, chosen) => {
    const asked: { title?: string; defaultPath?: string }[] = [];
    (globalThis as { e2eSaveAsked?: typeof asked }).e2eSaveAsked = asked;
    // Called as (options) or (window, options).
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = args[args.length - 1] as { title?: string; defaultPath?: string };
      asked.push({ title: options.title, defaultPath: options.defaultPath });
      return chosen === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: chosen };
    }) as typeof dialog.showSaveDialog;
  }, to);
}
const saveAsked = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { e2eSaveAsked?: { title?: string; defaultPath?: string }[] }).e2eSaveAsked ?? []);

/** A subtitle file's cues: start and end in milliseconds, and their lines. SRT numbers its cues; WebVTT does not. */
function cuesOf(text: string) {
  const ms = (stamp: string) => {
    const [h, m, s, milli] = stamp.split(/[:,.]/).map(Number);
    return ((h * 60 + m) * 60 + s) * 1000 + milli;
  };
  return text.trim().split(/\n\n+/).filter((block) => block.includes('-->')).map((block) => {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => line.includes('-->'));
    const [start, end] = lines[at].split(' --> ');
    return { index: at > 0 ? lines[0] : null, startMs: ms(start), endMs: ms(end), lines: lines.slice(at + 1) };
  });
}

/** How long a saved recording plays, decoded the way the page's own audio would decode it. */
const decodedSeconds = (page: Page, file: string) => page.evaluate(async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(bytes.buffer);
  return audio.duration;
}, fs.readFileSync(file).toString('base64'));

const EXCHANGES = [
  { source: 'Hello, how are you?', translation: 'こんにちは、お元気ですか？' },
  { source: 'I am fine. Thank you.', translation: '元気です。ありがとう。' },
];

// A record exports as it was said: copying and the .txt give the same conversation (the .txt with a header), the
// .json is the conversation export's own format with the same sentences at the same times, the two subtitle files
// hold the same cues on the record's clock, and the recording is saved where the Save dialog says and plays.
test('a record exports the same conversation as text, JSON and subtitles, and saves its recording', async ({ launchApp }, testInfo) => {
  const sokuji = await launchApp({ seed: { storage: baseStorage('fake') } });
  const { page, app, userData } = sokuji;
  const dir = testInfo.outputPath('saved');
  fs.mkdirSync(dir, { recursive: true });
  await saveDownloadsTo(app, dir);

  // A session through both of the fake's exchanges. The panel is empty first: the text found is this session's.
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('Click Start to begin real-time translation')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(EXCHANGES[1].translation).first()).toBeVisible({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('[data-record] .history-row__open').first().click();
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  const item = (name: string) => page.getByRole('menuitem', { name, exact: true });
  await exportButton.click();

  // The menu: what the record has is offered; notes it does not have are there but greyed.
  await expect(page.getByRole('menuitem')).toHaveText([
    'Copy the conversation', 'Save the conversation (.txt)', 'Save the conversation (.json)', 'Save subtitles (.srt)',
    'Save subtitles (.vtt)', 'Copy notes', 'Save notes (.md)', 'Save notes (.txt)', 'Save the recording (.opus)',
  ]);
  for (const name of ['Copy notes', 'Save notes (.md)', 'Save notes (.txt)']) await expect(item(name)).toBeDisabled();

  // Copy: both exchanges, each under its time and side, the translation after the arrow.
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await item('Copy the conversation').click();
  await expect(page.getByText('Copied.')).toBeVisible();
  let copied = '';
  await expect.poll(async () => (copied = await app.evaluate(({ clipboard }) => clipboard.readText())), { timeout: 5_000 }).not.toBe('');
  const block = /^\[(\d{2}:\d{2}:\d{2})\] Me\n {2}(.+)\n {2}→ (.+)$/;
  const blocks = copied.trim().split('\n\n').map((b) => b.match(block));
  expect(blocks.map((b) => b && [b[2], b[3]])).toEqual(EXCHANGES.map((e) => [e.source, e.translation]));
  const clock = blocks.map((b) => b![1]);

  // .txt: a header naming the service, then exactly what was copied.
  await exportButton.click();
  const txt = await download(app, dir, () => item('Save the conversation (.txt)').click());
  expect(txt.name).toMatch(/^sokuji-conversation-\d{8}-\d{6}\.txt$/);
  expect(txt.text).toContain('Provider: fake');
  // When the session started, and when the file was saved: the one is the file's name, the other is now.
  const header = txt.text.split('\n');
  expect(header[1]).toMatch(/^Session started: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(header[2]).toMatch(/^Exported: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const stamp = (line: string) => line.slice(line.indexOf(': ') + 2).replace(/[-: ]/g, '');
  expect(txt.name).toBe(`sokuji-conversation-${stamp(header[1]).slice(0, 8)}-${stamp(header[1]).slice(8)}.txt`);
  expect(txt.text.endsWith(`\n\n${copied}`)).toBe(true);

  // .json: the conversation export's format, the same sentences, at the times the text shows.
  await exportButton.click();
  const json = await download(app, dir, () => item('Save the conversation (.json)').click());
  expect(json.name).toBe(txt.name.replace(/\.txt$/, '.json'));
  const data = JSON.parse(json.text) as {
    format: string; provider: string; sessionStartedAt: string; exportedAt: string;
    groups: { t: number; source: { text: string }; translation: { text: string } }[];
  };
  expect(Object.keys(data)).toEqual(['format', 'sessionStartedAt', 'exportedAt', 'appVersion', 'provider', 'models', 'languages', 'groups', 'notices']);
  expect(data.format).toBe('sokuji-conversation/2');
  expect(data.provider).toBe('fake');
  expect(data.groups.map((g) => [g.source.text, g.translation.text]))
    .toEqual(EXCHANGES.map((e) => [e.source, e.translation]));
  for (const group of data.groups) expect(Object.keys(group)).toEqual(['id', 'leg', 't', 'pairing', 'source', 'translation']);
  const times = data.groups.map((g) => g.t);
  expect(times.map((t) => new Date(t).toTimeString().slice(0, 8))).toEqual(clock);
  // The session started before its first sentence, and the file was saved after its last.
  expect(Date.parse(data.sessionStartedAt)).toBeLessThanOrEqual(times[0]);
  expect(Date.parse(data.exportedAt)).toBeGreaterThan(times[times.length - 1]);

  // Subtitles: one cue per exchange, its sentence over its translation, on the record's clock, the same in both files.
  await exportButton.click();
  const srt = await download(app, dir, () => item('Save subtitles (.srt)').click());
  await exportButton.click();
  const vtt = await download(app, dir, () => item('Save subtitles (.vtt)').click());
  expect(srt.name).toBe(txt.name.replace(/\.txt$/, '.srt'));
  expect(vtt.name).toBe(txt.name.replace(/\.txt$/, '.vtt'));
  expect(srt.text).toMatch(/^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/);
  expect(vtt.text.startsWith('WEBVTT\n\n')).toBe(true);
  const cues = cuesOf(srt.text);
  expect(cues.map((c) => c.index)).toEqual(['1', '2']);
  expect(cues.map((c) => c.lines)).toEqual(EXCHANGES.map((e) => [e.source, e.translation]));
  expect(cuesOf(vtt.text).map(({ startMs, endMs, lines }) => ({ startMs, endMs, lines })))
    .toEqual(cues.map(({ startMs, endMs, lines }) => ({ startMs, endMs, lines })));
  for (const cue of cues) expect(cue.endMs).toBeGreaterThan(cue.startMs);
  expect(cues[1].startMs).toBeGreaterThanOrEqual(cues[0].endMs);
  // The second exchange comes as long after the first in the subtitles as in the conversation.
  expect(Math.abs((cues[1].startMs - cues[0].startMs) - (times[1] - times[0]))).toBeLessThan(100);

  // The recording: Cancel saves nothing and says nothing; then it is saved where the dialog says, and it plays.
  const opus = path.join(dir, 'recording.opus');
  await answerSaveDialogKeepingAsked(app, null);
  await exportButton.click();
  await item('Save the recording (.opus)').click();
  await expect.poll(async () => (await saveAsked(app)).length).toBe(1);
  await answerSaveDialogKeepingAsked(app, opus);
  await exportButton.click();
  await item('Save the recording (.opus)').click();
  await expect.poll(() => fs.existsSync(opus) && fs.statSync(opus).size, { timeout: 10_000 }).toBeGreaterThan(0);
  const [asked] = await saveAsked(app);
  expect(asked.title).toBe('Save the recording');
  expect(path.basename(asked.defaultPath ?? '')).toMatch(/^sokuji-recording-\d{8}-\d{6}-me\.opus$/);
  await expect(page.getByText('The recording could not be saved.')).toHaveCount(0);
  const bytes = fs.readFileSync(opus);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('OggS');
  expect(bytes.includes(Buffer.from('OpusHead'))).toBe(true);
  // It decodes to sound of the session's length (the recording starts a little after the record does, as the
  // microphone opens, so its length is compared with the kept track's below rather than with the subtitles).
  const seconds = await decodedSeconds(page, opus);
  expect(seconds).toBeGreaterThan(2);

  expect(sokuji.errors).toEqual([]);
  await sokuji.close();
  // The saved file is the kept recording, whole.
  const [record] = readHistory(userData);
  expect(record.tracks).toHaveLength(1);
  expect(bytes.length).toBe(record.tracks[0].fileBytes);
  expect(Math.abs(seconds * 1000 - record.tracks[0].durationMs)).toBeLessThan(500);
});
