import type { Page } from '@playwright/test';
import { openFolds } from './library';
import { expect } from './test';

/**
 * Downloads a native model (This device (Native)) from its card on Local models and storage's native engine tab, the
 * page being open there: every "N more" fold is opened first, since a model that is neither on disk nor recommended
 * waits under one. Resolves once the card offers Delete, that is once the model is on disk.
 */
export async function downloadNative(page: Page, modelId: string): Promise<void> {
  await page.getByRole('tab', { name: /Native engine/ }).click();
  const card = page.getByTestId(`model-card-${modelId}`);
  // The tab draws its lists, folds and all, only once the engine is up: until then there is no fold to open.
  await expect(async () => {
    await openFolds(page);
    await expect(card).toBeVisible({ timeout: 1_000 });
  }, `the native ${modelId} card is listed`).toPass({ timeout: 5 * 60_000 });
  const download = card.getByRole('button', { name: /^Download$/ });
  if (await download.count() > 0) await download.click();
  await expect(card.getByRole('button', { name: /^Delete$/ }), `the native ${modelId} is downloaded`).toBeVisible({ timeout: 40 * 60_000 });
}
