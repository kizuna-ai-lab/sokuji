// The settings page draws today's sections (rows, selects, key fields), whose
// styles live in Settings.scss. The page itself must load that stylesheet:
// jsdom cannot see a missing one, so the import is pinned here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/components/SettingsPage/SettingsPage.tsx'), 'utf8');

describe('the settings page styles', () => {
  it("loads the shared settings stylesheet besides its own", () => {
    expect(source).toMatch(/^import '\.\.\/Settings\/Settings\.scss';$/m);
    expect(source).toMatch(/^import '\.\/SettingsPage\.scss';$/m);
  });
});
