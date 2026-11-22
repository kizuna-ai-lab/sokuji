import type { Page } from '@playwright/test';
import { baseStorage } from '../support/app';
import { expect, test } from '../support/test';

// A service not set up yet (owner, 2026-11-22): it stays a choice in Languages and line-up, says what it needs, and
// its card leads to where that is set up. Accounts and keys gives a row a button only where there is something to do.
// This device, Bing and Edge need no key, so the app opens on them; Gemini's text model has no key here.

const seed = {
  storage: {
    ...baseStorage('local_inference'),
    'settings.lineup': JSON.stringify({ version: 2, stages: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null } }),
    // A translator of its own takes no automatic source.
    'settings.common.sourceLanguage': 'en',
    'settings.common.targetLanguage': 'ja',
  },
};

async function openSettings(page: Page, category: RegExp): Promise<void> {
  await expect(page.locator('[data-tour="settings-button"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: category }).click();
}

const storedStages = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('settings.lineup') ?? 'null') as { stages: Record<string, string | null> } | null)?.stages ?? null);

test('a service with no key yet can be chosen: the list and the shown choice say it needs a key, and its card leads to the key', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed });
  const { page } = sokuji;
  await openSettings(page, /^Languages and line-up/);

  const translation = page.getByRole('combobox', { name: 'Translation', exact: true });
  const gemini = translation.locator('option[value="gemini_text"]');
  await expect(gemini).toBeEnabled();
  await expect(gemini).toContainText('needs a key');

  await translation.selectOption('gemini_text');
  await expect.poll(() => storedStages(page)).toMatchObject({ transcription: 'local_inference', translation: 'gemini_text', speech: 'edge' });
  // The select shows a copy of the chosen option: it says what the service needs, as the option does.
  const shown = translation.locator('selectedcontent');
  if (await shown.count() > 0) await expect(shown).toContainText('needs a key');

  // The card's state says so, and leads to the key.
  const card = page.locator('.lineup-stage').filter({ has: translation });
  await card.locator('.lineup-stage__head').getByRole('button', { name: 'Needs a key' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts and keys' })).toBeVisible();
  await sokuji.close();
});

test("Accounts and keys: Bing and Edge have no button, and This device's goes to Models and storage", async ({ launchApp }) => {
  const sokuji = await launchApp({ seed });
  const { page } = sokuji;
  await openSettings(page, /^Accounts and keys/);

  for (const name of ['Bing', 'Edge']) await expect(page.getByRole('group', { name, exact: true }).getByRole('button')).toHaveCount(0);
  await page.getByRole('group', { name: 'This device', exact: true }).getByRole('button', { name: 'Manage models' }).click();
  await expect(page.getByRole('heading', { name: 'Models and storage' })).toBeVisible();
  await sokuji.close();
});
