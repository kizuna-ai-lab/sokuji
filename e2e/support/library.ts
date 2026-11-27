import type { Page } from '@playwright/test';
import { expect } from './test';

/**
 * Opens every "N more" fold of the engine tab Local models and storage shows: a model that is neither on disk nor
 * recommended waits under one. A fold keeps its label once open and only turns `aria-expanded`, so the first one still
 * closed is clicked until none is, each click waited out before the next.
 */
export async function openFolds(page: Page): Promise<void> {
  const closed = page.getByRole('button', { name: /^\d+ more/, expanded: false });
  for (let left = await closed.count(); left > 0; left--) {
    await closed.first().click();
    await expect(closed, 'the fold opens').toHaveCount(left - 1);
  }
}
