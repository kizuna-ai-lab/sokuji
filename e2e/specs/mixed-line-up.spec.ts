import { baseStorage, mainAction } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

// A line-up of two services: the fake service transcribes and translates, the fake voice reads the translations.
// The stored line-up decides what runs, and the record names who did each stage.
test('a session on the fake service with the fake voice runs, and its record names both', async ({ launchApp }) => {
  const sokuji = await launchApp({
    seed: {
      storage: {
        ...baseStorage('fake'),
        'settings.lineup': JSON.stringify({ version: 2, stages: { transcription: 'fake', translation: 'fake', speech: 'fake_voice', summarisation: null } }),
      },
    },
  });
  const { page, userData } = sokuji;

  // Both services are loaded and ready before Start is offered.
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  // The fake service's script, through both of its exchanges: each translation appears while the session runs.
  // The voice is handed a translation when its row closes (the fake states no stable length before that).
  await expect(page.getByText('こんにちは、お元気ですか？').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('元気です。ありがとう。').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2_000); // the last row closes and is read
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await sokuji.close();

  const stored = readHistory(userData);
  expect(stored).toHaveLength(1);
  expect(stored[0].state).toBe('closed');
  const services = JSON.parse(stored[0].services) as { provider: string; stages?: Record<string, string> };
  // The record's one provider is the one that transcribes; its stages name each service.
  expect(services.provider).toBe('fake');
  expect(services.stages).toEqual({ transcription: 'fake', translation: 'fake', speech: 'fake_voice' });
  expect(stored[0].sentences).toBeGreaterThan(0);
  // What was heard and what it was translated to are both kept.
  const kept = (side: 'source' | 'translation') => stored[0].segments.filter((segment) => segment.side === side).map((segment) => segment.text).join('\n');
  expect(kept('source')).toContain('Hello, how are you?');
  expect(kept('translation')).toContain('こんにちは、お元気ですか？');
  expect(sokuji.errors).toEqual([]);

  // Started again on the same state: the mixed line-up is still what is stored, and Start is offered.
  const again = await launchApp({ userData });
  await expect(mainAction(again.page)).toBeEnabled({ timeout: 30_000 });
  const lineUp = await again.page.evaluate(() => JSON.parse(localStorage.getItem('settings.lineup') ?? 'null') as { version: number; stages: Record<string, string | null> } | null);
  expect(lineUp).toEqual({ version: 2, stages: { transcription: 'fake', translation: 'fake', speech: 'fake_voice', summarisation: null } });
  await again.close();
});
