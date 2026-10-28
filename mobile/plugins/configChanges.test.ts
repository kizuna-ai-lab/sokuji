import { describe, expect, it } from 'vitest';
// The plugin is CommonJS (Expo loads it from app.json as-is).
import { addConfigChanges } from './withFontScaleConfigChanges';

describe('the Android activity keeps running when the font size or display size changes', () => {
  it('adds fontScale and density to the template value', () => {
    const template = 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths|locale|layoutDirection';
    expect(addConfigChanges(template).split('|')).toEqual([...template.split('|'), 'fontScale', 'density']);
  });

  it('adds nothing twice and keeps what was there', () => {
    expect(addConfigChanges('orientation|fontScale')).toBe('orientation|fontScale|density');
    expect(addConfigChanges(undefined)).toBe('fontScale|density');
  });
});
