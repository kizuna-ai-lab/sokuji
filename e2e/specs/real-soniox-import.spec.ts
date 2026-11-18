import fs from 'node:fs';
import path from 'node:path';
import { baseStorage, REPO } from '../support/app';
import { expect, test } from '../support/test';
import { transcriptionLineUp } from '../support/transcription';

const KEY = process.env.E2E_SONIOX_KEY ?? '';

/** Four of the repository's Japanese sentences (scripts/dev/wire-probe/assets/ja): a word each must be heard, and a word its English must carry. */
const SENTENCES = [
  { file: 'umbrella', heard: /傘/, said: /umbrella/i }, // 今日は雨が降りそうなので、傘を持っていきます。
  { file: 'meeting', heard: /会議/, said: /meeting/i }, // 明日の会議は午後三時に始まります。
  { file: 'dinner', heard: /夕食|夕飯|晩ご飯/, said: /dinner|supper/i }, // 週末に家族と一緒に夕食を食べました。
  { file: 'cafe', heard: /カフェ/, said: /caf[eé]|coffee/i }, // 駅の近くに新しいカフェができました。
];

/** The sentences one after another, two seconds apart, as one 16 kHz mono WAV file. */
function conversation(dir: string): string {
  const pieces: Buffer[] = [];
  for (const s of SENTENCES) {
    const wav = fs.readFileSync(path.join(REPO, 'scripts/dev/wire-probe/assets/ja', `${s.file}.wav`));
    let at = 12;
    while (wav.toString('latin1', at, at + 4) !== 'data') at += 8 + wav.readUInt32LE(at + 4);
    pieces.push(wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4)), Buffer.alloc(16_000 * 2 * 2));
  }
  const data = Buffer.concat(pieces);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(16_000, 24);
  head.writeUInt32LE(32_000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  const file = path.join(dir, 'japanese-conversation.wav');
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return file;
}

// The key is typed into the app: a trace would keep it.
test.use({ trace: 'off' });

// Tagged @real: sends a file to Soniox itself with a key from E2E_SONIOX_KEY, so it is left out of `npm run e2e` and
// run with `npm run e2e:real`. What the fake service cannot show: Soniox's own answer to the options chosen at import
// (the language spoken, the translation), read into the record as its sentences and their translations.
test('@real a Japanese file imported through Soniox is transcribed and translated into English', async ({ launchApp }, testInfo) => {
  test.skip(!KEY, 'E2E_SONIOX_KEY is not set');
  test.setTimeout(5 * 60_000);
  const file = conversation(testInfo.outputPath());
  const sokuji = await launchApp({ seed: { storage: { ...baseStorage('soniox'), 'settings.lineup': JSON.stringify(transcriptionLineUp) } } });
  const { page, userData } = sokuji;

  try {
    // The key goes in the way a user puts it in: Settings, Accounts and keys, Soniox.
    await page.locator('[data-tour="settings-button"]').click();
    await page.getByRole('navigation').getByRole('button', { name: /^Accounts and keys/ }).click();
    await page.getByRole('group', { name: 'Soniox', exact: true }).getByRole('button', { name: 'Add key' }).click();
    await page.getByPlaceholder('Soniox API key').fill(KEY);
    await page.getByRole('button', { name: 'Save and find its region' }).click();
    await expect(page.locator('.soniox-key__line')).toContainText(/Key works · Belongs to /, { timeout: 60_000 });
    await page.keyboard.press('Escape');
    // Finding the key's region asks every region, and the ones the key does not belong to refuse it: those refusals are expected.
    expect(sokuji.errors.filter((e) => !/status of 401/.test(e))).toEqual([]);
    sokuji.errors.length = 0;

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.locator('input[type="file"][accept="audio/*,video/*"]').setInputFiles(file);
    const panel = page.getByRole('dialog', { name: 'Import “japanese-conversation.wav”' });
    await panel.getByLabel('Main language').selectOption('ja');
    await panel.getByLabel('Translate into').selectOption('en');
    await panel.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('.history-file__line[role="status"]')).toHaveCount(0, { timeout: 4 * 60_000 });
    await expect(page.locator('.history-file__line[role="alert"]')).toHaveCount(0);

    await page.locator('.history-list [data-record] .history-row__open').first().click();
    const transcript = page.locator('.record-page__transcript');
    await expect(transcript.locator('.record-row').first()).toBeVisible();
    // Each row: what was heard, and the translation under it. A sentence's translation must be in its own row (rows
    // may hold more than one sentence), so two rows' translations swapped do not pass.
    const rows = await transcript.locator('.record-row').evaluateAll((els) => els.map((el) => ({
      heard: el.querySelector('.record-row__text')?.textContent ?? '',
      translated: el.querySelector('.record-row__translation')?.textContent ?? '',
    })));
    test.info().annotations.push({ type: 'rows', description: rows.map((r) => `${r.heard} → ${r.translated}`).join('\n') });
    for (const s of SENTENCES) {
      const row = rows.find((r) => s.heard.test(r.heard));
      expect(row, `${s.file}: heard`).toBeTruthy();
      expect(row!.translated, `${s.file}: translated in its own row`).toMatch(s.said);
    }
    expect(sokuji.errors).toEqual([]);
  } finally {
    // The app keeps the key in its settings: whatever happened, it does not stay on disk. The rest of a failed run's
    // directory is left to be looked at.
    await sokuji.kill();
    fs.rmSync(path.join(userData, 'Local Storage'), { recursive: true, force: true });
  }
});
