import type { Page } from '@playwright/test';
import { expect } from './test';

/**
 * Downloads a native model (This device (Native)) from its card on Local models and storage's native engine tab, the
 * page being open there: every "N more" fold is opened first, since a model that is neither on disk nor recommended
 * waits under one. Resolves once the card offers Delete, that is once the model is on disk.
 */
export async function downloadNative(page: Page, modelId: string): Promise<void> {
  await page.getByRole('tab', { name: /Native engine/ }).click();
  for (const more of await page.getByRole('button', { name: /^\d+ more/, expanded: false }).all()) await more.click().catch(() => {});
  const card = page.getByTestId(`model-card-${modelId}`);
  await expect(card, `the native ${modelId} card is listed`).toBeVisible({ timeout: 5 * 60_000 });
  const download = card.getByRole('button', { name: /^Download$/ });
  if (await download.count() > 0) await download.click();
  await expect(card.getByRole('button', { name: /^Delete$/ }), `the native ${modelId} is downloaded`).toBeVisible({ timeout: 40 * 60_000 });
}
