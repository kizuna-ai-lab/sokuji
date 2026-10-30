import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo as {
  icon: string;
  android: { adaptiveIcon: { foregroundImage: string; backgroundImage: string; monochromeImage: string; backgroundColor: string } };
};
// A PNG's size sits in its IHDR chunk: width at byte 16, height at byte 20.
const pngSize = (file: string) => {
  const b = readFileSync(join(root, file));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

// Android lays the foreground over the background and cuts both with the
// launcher's mask (a circle on the Pixel). The Expo template's light-blue
// background under the whole black icon showed as a square inside the circle:
// the background is the icon's own black, and every layer is a full 1024 canvas.
describe('Android adaptive icon', () => {
  it('uses the icon\'s black as the background', () => {
    expect(app.android.adaptiveIcon.backgroundColor.toLowerCase()).toBe('#000000');
  });

  it('ships every layer at 1024×1024', () => {
    for (const file of [app.icon, app.android.adaptiveIcon.foregroundImage, app.android.adaptiveIcon.backgroundImage, app.android.adaptiveIcon.monochromeImage]) {
      expect(pngSize(file), file).toEqual([1024, 1024]);
    }
  });
});
