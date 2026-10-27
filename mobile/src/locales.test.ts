import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, 'locales');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo as { locales: Record<string, string> };

// The microphone usage string is an iOS Info.plist key only. Expo copies a
// locale file's top-level keys into Android's strings.xml as well, where a
// string present in 30 languages but absent from the default one fails the
// release lint (ExtraTranslation): so the key lives under `ios`.
describe('mobile/locales', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  it('keeps the microphone string under ios only, in every file', () => {
    expect(files.length).toBe(30);
    for (const f of files) {
      const json = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
      expect(Object.keys(json), f).toEqual(['ios']);
      const ios = json.ios as Record<string, unknown>;
      expect(typeof ios.NSMicrophoneUsageDescription, f).toBe('string');
      expect((ios.NSMicrophoneUsageDescription as string).length, f).toBeGreaterThan(0);
    }
  });

  it('lists every file in app.json and nothing else', () => {
    expect(Object.values(app.locales).map((p) => p.replace('./locales/', '')).sort()).toEqual(files);
  });
});
