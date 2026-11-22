import type { Page } from '@playwright/test';
import { baseStorage, forgetSecrets, newUserData } from '../support/app';
import { readNotes } from '../support/history';
import { seedHistory, type SeedSentence } from '../support/seed';
import { expect, test } from '../support/test';

// Tagged @real: these talk to real services, so they are left out of `npm run e2e` and run with `npm run e2e:real`.
// Each is skipped without its key in the environment.
//
// The notes after a session written by a text model with the user's own key (text models, part C): OpenAI's with
// E2E_OPENAI_KEY, Gemini's with E2E_GEMINI_KEY. The session is a record seeded into History as a session leaves one
// (its transcript: a short meeting in English), as the notes test with a fake OpenAI does: the notes are written from
// the transcript's text alone, so no audio and no recognition service are needed. The key goes in the way a user puts
// it in (Accounts and keys), the notes service is the line-up's, its model and reasoning their defaults (Automatic,
// Medium).
//
// What each checks: the notes were written (a title, a way to write a new version), and History keeps the version as
// complete, written by the service with a model of its family.

const OPENAI_KEY = process.env.E2E_OPENAI_KEY ?? '';
const GEMINI_KEY = process.env.E2E_GEMINI_KEY ?? '';

// A key is typed into the app: a trace or a screenshot would keep it.
test.use({ trace: 'off', screenshot: 'off' });

/** A short planning meeting, two sides, about four minutes: enough for notes, with a decision, a to-do and a risk. */
const LINES = [
  'Thanks for joining. Today we need to settle the launch date for the new app.',
  'I talked to the design team yesterday. They need one more week for the onboarding screens.',
  'Then the first of March is too early. Can we move the launch to the eighth of March?',
  'The eighth works for marketing, as long as we tell the press by Friday.',
  'Good. Let us decide on the eighth of March then.',
  'Who will write the note to the press?',
  'I can write it, and I will send it to you on Thursday for a check.',
  'Thank you. What about the server costs? They went up last month.',
  'We moved to a bigger database. I think we can go back to the smaller one after the launch.',
  'Is there a risk that the smaller one is too slow on launch day?',
  'Yes, a little. If many people sign up in the first hour, it could be slow.',
  'Then we keep the big one for the first two weeks, and look at the numbers after that.',
  'Agreed. I will put a reminder in the calendar for the twenty second of March.',
  'One more thing: the translations for Japanese and German are not finished.',
  'Our translator says she can finish both by the first of March.',
  'That is fine with the new date. Please ask her to send them to the design team.',
  'I will. Anything else for today?',
  'No, that is all. Thank you, everyone.',
];
const MEETING: SeedSentence[] = LINES.map((text, i) => ({
  side: i % 2 === 0 ? 'mine' : 'other', text, startMs: i * 13_000, endMs: i * 13_000 + 11_000,
}));

/** A key goes in the way a user puts it in: Settings, Accounts and keys, the service's row, then its check. */
async function addKey(page: Page, row: string, key: string): Promise<void> {
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Accounts and keys/ }).click();
  const group = page.getByRole('group', { name: row, exact: true });
  await group.getByRole('button', { name: 'Add key' }).click();
  await group.getByLabel('API key', { exact: true }).fill(key);
  await group.getByRole('button', { name: 'Validate' }).click();
  await page.keyboard.press('Escape');
}

/** The record's page, and Write notes confirmed. */
async function writeNotes(page: Page) {
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('[data-record] .history-row__open').first().click();
  await page.getByRole('button', { name: 'Write notes' }).click();
  // The first time, the app says what is sent and to whom.
  await page.getByRole('group', { name: 'Before notes are written' }).getByRole('button', { name: 'Write notes' }).click();
}

for (const [service, row, key, variable, family] of [
  ['openai', 'OpenAI', OPENAI_KEY, 'E2E_OPENAI_KEY', /^(?:gpt-|o\d)/],
  ['gemini_text', 'Google Gemini', GEMINI_KEY, 'E2E_GEMINI_KEY', /^(?:gemini-|gemma-)/],
] as const) {
  test(`@real notes after a session, written by ${service} with an own key`, async ({ launchApp }) => {
    test.skip(!key, `${variable} is not set`);
    test.setTimeout(10 * 60_000);
    const userData = newUserData();
    seedHistory(userData, [{ id: `e2e-real-notes-${service.replace(/_/g, '-')}`, startedAt: Date.now() - 3_600_000, durationMs: LINES.length * 13_000, sentences: MEETING }]);
    const sokuji = await launchApp({
      userData,
      seed: {
        storage: {
          ...baseStorage('fake'),
          'settings.lineup': JSON.stringify({ version: 2, stages: { transcription: 'fake', translation: 'fake', speech: 'fake', summarisation: service } }),
        },
      },
    });
    const { page } = sokuji;
    try {
      await addKey(page, row, key);
      await writeNotes(page);
      const notes = page.getByRole('region', { name: 'Notes' });
      // Written: the notes' title, and the way to write a new version, which only complete notes offer.
      await expect(notes.getByRole('button', { name: 'Write a new version' })).toBeVisible({ timeout: 5 * 60_000 });
      await expect(notes.getByRole('heading').first()).toBeVisible();
      await expect(notes.getByText(/^Written by /)).toBeVisible();
      await sokuji.close();

      const versions = readNotes(userData);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ state: 'complete', failure: null, writtenBy: { kind: 'sokuji', service } });
      expect(versions[0].writtenBy.model ?? '').toMatch(family);
      expect(versions[0].title ?? '').not.toBe('');
      test.info().annotations.push({ type: 'notes', description: `${versions[0].writtenBy.model}: ${versions[0].title}` });
    } finally {
      // The app keeps the key in its settings: whatever happened, it does not stay on disk.
      await sokuji.kill();
      forgetSecrets(userData);
    }
  });
}
