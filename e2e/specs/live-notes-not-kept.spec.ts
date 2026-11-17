import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { baseStorage, mainAction } from '../support/app';
import { fakeOpenAi, sentenceIds, type OpenAiRequest } from '../support/openai';
import { expect, test } from '../support/test';

/**
 * A live notes update in the shape live notes ask for (a title, and a new topic with a point at the first sentence it
 * was sent), under names of its own so it cannot be taken for anything else on the record.
 */
function liveAnswer(request: OpenAiRequest) {
  const [first] = sentenceIds(request);
  return {
    answer: {
      title: 'Live notes title',
      new_topic: { title: 'Live topic', summary: 'Live topic summary.', points: [{ text: 'Live point', sid: first ?? 1, kinds: [] }] },
    },
  };
}

/** Every notes body History keeps, as text. Read after the app has closed: it owns the file while it runs. */
function keptNotes(userData: string): string[] {
  const file = path.join(userData, 'history', 'history.db');
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('select body from notes').all() as { body: unknown }[]).map((row) => String(row.body));
  } finally {
    db.close();
  }
}

// Live notes are written during a session and are not kept: after Stop the panel still shows them, says they are not
// kept and offers the record in History; the record, on its page and in what History keeps, has no trace of them.
test('live notes are shown during a session and not kept: after Stop the record has no trace of them', async ({ launchApp }) => {
  const sokuji = await launchApp({
    seed: {
      storage: {
        ...baseStorage('fake'),
        'settings.openai.apiKey': 'sk-e2e-not-a-real-key',
        'settings.notes.live': 'true',
        'settings.notes.liveExplained': 'true',
      },
    },
  });
  const { page, userData } = sokuji;
  const openai = await fakeOpenAi(sokuji);
  openai.answerChat(liveAnswer);

  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('Click Start to begin real-time translation')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('元気です。ありがとう。').first()).toBeVisible({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });

  // After Stop: the live notes are still shown, the panel says they are not kept, and offers History.
  const live = page.getByRole('complementary', { name: 'Live notes' });
  await expect(live.getByRole('heading', { name: 'Live notes title' })).toBeVisible({ timeout: 30_000 });
  await expect(live.getByText('Live topic')).toBeVisible();
  await expect(live.getByText('Live point')).toBeVisible();
  await expect(live.getByText('Live notes are not kept. The session is in History.')).toBeVisible();
  expect(openai.requests.some((r) => r.path === '/chat/completions')).toBe(true);

  // The record: none of the live notes, on the page or in what History keeps. (This session is too short for full
  // notes; writing them on a record is the notes test's business.)
  await live.getByRole('button', { name: 'Open History' }).click();
  const record = page.locator('.record-page');
  await expect(record.locator('.record-page__transcript').getByText('Hello, how are you?')).toBeVisible();
  await expect(record.getByText('There is too little in this record to write notes from.')).toBeVisible();
  for (const word of ['Live notes title', 'Live topic', 'Live point']) await expect(record.getByText(word)).toHaveCount(0);
  expect(openai.failures).toEqual([]);
  expect(sokuji.errors).toEqual([]);
  await sokuji.close();
  expect(keptNotes(userData)).toEqual([]);
});
