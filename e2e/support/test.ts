import { test as base } from '@playwright/test';
import { launch, removeUserData, type Sokuji } from './app';

type Launch = typeof launch;

/**
 * `launchApp` is `launch` with the ending taken care of: every app a test started is killed when the test ends,
 * passed or failed, so a failed assertion never leaves an Electron running. The user-data directories of a test
 * that passed are deleted; a failed test keeps them to be looked at.
 */
export const test = base.extend<{ launchApp: Launch }>({
  launchApp: async ({}, use, testInfo) => {
    const started: Sokuji[] = [];
    await use(async (options) => {
      const sokuji = await launch(options);
      started.push(sokuji);
      return sokuji;
    });
    for (const sokuji of started) await sokuji.kill();
    if (testInfo.status === testInfo.expectedStatus) for (const sokuji of started) removeUserData(sokuji.userData);
  },
});

export { expect } from '@playwright/test';
