/**
 * A Kizuna-managed provider is Kizuna AI's own service running on a third
 * party engine, so its mark has to read "Kizuna AI, powered by <vendor>":
 * the Kizuna logo carries the identity and the vendor rides along as a corner
 * badge. Kizuna Soniox's definition draws its mark this way; the plated
 * shape is the one a vendor mark with no background of its own takes.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { kizunaHostedIcon, HOSTED_BADGE_RATIO, SonioxIcon, OpenAIIcon, VolcengineIcon } from './ProviderIcons';

/** Kizuna Soniox's own mark: Soniox's favicon carries its white plate. */
const SONIOX_HOSTED = kizunaHostedIcon(SonioxIcon);
/** A transparent `currentColor` glyph, plated and forced to a colour. */
const PLATED_GLYPH = kizunaHostedIcon(OpenAIIcon, { plate: true, color: '#000' });
/** Transparent coloured paths, plated. */
const PLATED_PATHS = kizunaHostedIcon(VolcengineIcon, { plate: true });

const badgeOf = (container: HTMLElement) =>
  container.querySelector('.hosted-provider-icon__badge') as HTMLElement;

/** Sizes are calc() expressions; jsdom normalises `calc(24px * 0.58)` to
 *  `calc(13.92px)`. Pull the number back out so assertions stay derived from
 *  HOSTED_BADGE_RATIO instead of hard-coding whatever it currently is. */
const cssPx = (value: string) => parseFloat(value.replace(/[^0-9.]/g, ''));

describe('Kizuna-hosted provider icons', () => {
  it('renders the Kizuna logo with the vendor mark as a corner badge', () => {
    const Icon = SONIOX_HOSTED;
    const { container } = render(<Icon size={24} />);

    const logo = container.querySelector('img');
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute('alt')).toBe('Kizuna AI');
    // The Kizuna logo is a PNG, so the vendor mark is the only svg here.
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it.each([
    ['bare', SONIOX_HOSTED],
    ['plated glyph', PLATED_GLYPH],
    ['plated paths', PLATED_PATHS],
  ] as const)(
    'a %s mark renders both the Kizuna logo and a vendor badge',
    (_shape, Icon) => {
      const { container } = render(<Icon size={24} />);

      expect(container.querySelector('img')).not.toBeNull();
      expect(badgeOf(container)).not.toBeNull();
    },
  );

  it('sizes the badge with inline styles so Settings.scss cannot blow it up', () => {
    // Settings.scss carries `.provider-icon svg { width: 24px; height: 24px }`
    // (and 20px for the dropdown rows). A stylesheet rule outranks an svg's
    // width/height *attributes*, so relying on those would stretch the badge
    // to full size and bury the Kizuna logo underneath it. Inline styles
    // outrank any stylesheet rule, so the badge must set them.
    const Icon = SONIOX_HOSTED;
    const { container } = render(<Icon size={24} />);

    const mark = container.querySelector('svg') as SVGElement;
    expect(mark.style.width).not.toBe('');
    expect(cssPx(mark.style.width)).toBeCloseTo(24 * HOSTED_BADGE_RATIO, 5);
    expect(cssPx(mark.style.height)).toBeCloseTo(24 * HOSTED_BADGE_RATIO, 5);
  });

  it('keeps a string size as a CSS dimension instead of parsing it to pixels', () => {
    // IconProps.size is `string | number`, and every other icon in this file
    // hands the value straight to the svg's width/height attributes, so `1em`
    // and `100%` work. This composite is the only one that does arithmetic on
    // it — parseFloat turned `1em` into 1, i.e. a one-pixel badge.
    const Icon = SONIOX_HOSTED;
    const { container } = render(<Icon size="1em" />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('style')).toContain('1em');

    // The badge keeps the caller's unit — `calc(0.58em)`, not a pixel count.
    const mark = container.querySelector('svg') as SVGElement;
    expect(mark.getAttribute('style')).toContain('em');
    expect(mark.getAttribute('style')).not.toContain('px');
  });

  it('keeps the badge between "visible" and "competing"', () => {
    // Below ~0.45 the vendor mark stops being identifiable at the 20px dropdown
    // size; above ~0.58 it clips the Kizuna signature stroke and starts reading
    // as a co-equal mark, which would blur the managed twin against the BYOK
    // provider sitting next to it in the same list. The number is a judgement
    // call, but drifting out of this band is not one — it changes what the icon
    // says about the row.
    expect(HOSTED_BADGE_RATIO).toBeGreaterThanOrEqual(0.45);
    expect(HOSTED_BADGE_RATIO).toBeLessThanOrEqual(0.58);
  });

  it('scales the badge with the icon size', () => {
    const Icon = SONIOX_HOSTED;
    const { container } = render(<Icon size={20} />);

    const mark = container.querySelector('svg') as SVGElement;
    expect(cssPx(mark.style.width)).toBeCloseTo(20 * HOSTED_BADGE_RATIO, 5);
  });

  it('rings the badge so it separates from the logo art behind it', () => {
    const Icon = SONIOX_HOSTED;
    const { container } = render(<Icon size={24} />);

    expect(badgeOf(container).style.boxShadow).not.toBe('');
  });

  it('plates a vendor mark that has no background of its own', () => {
    // OpenAI's mark is a transparent `currentColor` glyph and Volcengine's is
    // transparent colored paths; dropped straight onto the Kizuna artwork
    // neither reads. A white plate gives them the same footing as Soniox's
    // own white square.
    const Icon = PLATED_GLYPH;
    const { container } = render(<Icon size={24} />);

    expect(badgeOf(container).style.background).toBe('rgb(255, 255, 255)');
  });

  it('forces a colour onto currentColor marks sitting on the plate', () => {
    // `.provider-icon { color: $text-muted }` cascades into the badge, which
    // would paint OpenAI's glyph #888 on a white plate.
    const Icon = PLATED_GLYPH;
    const { container } = render(<Icon size={24} />);

    const mark = container.querySelector('svg') as SVGElement;
    expect(mark.style.color).toBe('rgb(0, 0, 0)');
  });

  it('leaves a vendor mark that carries its own plate unplated', () => {
    // Soniox's official favicon is already a white rounded square; plating it
    // again would just fatten the white border.
    const Icon = SONIOX_HOSTED;
    const { container } = render(<Icon size={24} />);

    expect(badgeOf(container).style.background).toBe('');
  });
});
