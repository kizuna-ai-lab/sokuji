import type { Page } from '@playwright/test';
import { baseStorage, newUserData } from '../support/app';
import { meeting, seedHistory } from '../support/seed';
import { expect, test } from '../support/test';

// Design P1, end to end on a seeded record: the notes edited in place and marked, both edits undone; a speaker merged
// into another and the merge undone; the notes copied as HTML for documents and Markdown for chats.
const NOTES = {
  title: 'Supplier sync',
  overview: { text: 'Delivery and packaging.', format: 'plain' },
  topics: [{ title: 'Delivery', summary: 'The date.', first: 1 }],
  points: [
    { topic: 0, text: 'Ships next Tuesday', sentences: [2], kinds: ['decision'] },
    { topic: 0, text: 'Send the tracking number', sentences: [3], kinds: ['todo'], owner: 'My side', due: 'Tuesday' },
  ],
  names: [],
};

function seeded() {
  const userData = newUserData();
  // Twelve sentences, alternating sides; the other side's are two speakers, '1' and '2'.
  const sentences = meeting(12).map((s, i) => (s.side === 'other' ? { ...s, speaker: i % 4 === 1 ? '1' : '2' } : s));
  seedHistory(userData, [{ id: 'run-e2e-edit-notes', startedAt: Date.now() - 3_600_000, durationMs: 120_000, sentences, notes: NOTES }]);
  return userData;
}
const openHistory = (page: Page) => page.locator('.title-bar__action:has(svg.lucide-history)').click();
const undo = (page: Page) => page.getByRole('status', { name: 'What changed' }).getByRole('button', { name: 'Undo' }).click();

test('notes edited in place and undone, a speaker merged and the merge undone, the notes copied two ways', async ({ launchApp }) => {
  const { page, app } = await launchApp({ userData: seeded(), seed: { storage: baseStorage('fake') } });
  await openHistory(page);
  await page.locator('.history-list [data-record] .history-row__open').first().click();
  const notes = page.getByRole('region', { name: 'Notes' });
  await expect(notes.getByRole('heading', { name: 'Supplier sync' })).toBeVisible();

  // A to-do's text and date, then the notes' title.
  await notes.locator('li', { hasText: 'Send the tracking number' }).hover();
  await notes.locator('li', { hasText: 'Send the tracking number' }).getByRole('button', { name: 'Edit the point' }).click();
  await page.getByRole('textbox', { name: 'Point' }).fill('Send the tracking link');
  await page.getByRole('textbox', { name: 'Due' }).fill('Monday');
  await page.getByRole('textbox', { name: 'Point' }).press('Enter');
  await expect(notes.getByText('Send the tracking link')).toBeVisible();
  await expect(notes.getByText('Your side · Monday')).toBeVisible();
  await expect(notes.getByText('Edited by hand')).toBeVisible();
  await notes.getByRole('button', { name: 'Edit the title' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Supplier sync, week 47');
  await page.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(notes.getByRole('heading', { name: 'Supplier sync, week 47' })).toBeVisible();
  // The record took the notes' title.
  await expect(page.locator('.record-page__title')).toContainText('Supplier sync, week 47');

  // Both undone: the text, the date, the title, and the mark.
  await undo(page);
  await expect(notes.getByRole('heading', { name: 'Supplier sync' })).toBeVisible();
  await undo(page);
  await expect(notes.getByText('Send the tracking number')).toBeVisible();
  await expect(notes.getByText('Your side · Tuesday')).toBeVisible();
  await expect(notes.getByText('Edited by hand')).toHaveCount(0);

  // Speaker 2 of the other side merged into speaker 1, then back.
  const panel = page.getByRole('complementary', { name: 'Edit' });
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(panel.getByRole('button', { name: 'Rename Other 2' })).toBeVisible();
  await panel.getByRole('button', { name: 'Merge Other 2 into…' }).click();
  await page.getByRole('menu', { name: 'Merge into' }).getByRole('menuitem', { name: 'Other 1' }).click();
  await expect(page.getByRole('status', { name: 'What changed' })).toContainText('Other 2 merged into Other 1 (3 sentences)');
  await expect(panel.getByRole('button', { name: 'Rename Other 2' })).toHaveCount(0);
  await undo(page);
  await expect(panel.getByRole('button', { name: 'Rename Other 2' })).toBeVisible();

  // Copied for a document (HTML) and for a chat (Markdown).
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy notes', exact: true }).click();
  await expect(page.getByText('Copied.')).toBeVisible();
  // The clipboard as an app pasted into sees it (Electron's W3C-style read): the HTML beside the text.
  const html = () => app.evaluate(async ({ clipboard }) => {
    const item = (await clipboard.read()).find((x) => x.types.includes('text/html'));
    return item ? (await item.getType('text/html') as Blob).text() : '';
  });
  await expect.poll(html).toContain('<h2>Delivery</h2>');
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^# Supplier sync\n/);
});
