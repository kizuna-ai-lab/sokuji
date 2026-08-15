/**
 * The Kizuna-managed providers are Kizuna AI's own service running on a third
 * party engine, so their mark has to read "Kizuna AI, powered by <vendor>":
 * the Kizuna logo carries the identity and the vendor rides along as a corner
 * badge. Before this, all three rendered the bare Kizuna logo and were
 * indistinguishable from each other in the provider dropdown.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Provider, isKizunaManagedProvider } from '../../types/Provider';
import { KIZUNA_HOSTED_ICONS, HOSTED_BADGE_RATIO } from './ProviderIcons';

const badgeOf = (container: HTMLElement) =>
  container.querySelector('.hosted-provider-icon__badge') as HTMLElement;

/** Sizes are calc() expressions; jsdom normalises `calc(24px * 0.58)` to
 *  `calc(13.92px)`. Pull the number back out so assertions stay derived from
 *  HOSTED_BADGE_RATIO instead of hard-coding whatever it currently is. */
const cssPx = (value: string) => parseFloat(value.replace(/[^0-9.]/g, ''));

describe('Kizuna-hosted provider icons', () => {
  it('covers exactly the Kizuna-managed providers', () => {
    // Adding a fourth managed twin without giving it a badge would silently
    // fall back to the bare Kizuna logo, which is the bug this whole component
    // exists to fix — so fail loudly instead.
    const managed = Object.values(Provider).filter(isKizunaManagedProvider).sort();
    expect(Object.keys(KIZUNA_HOSTED_ICONS).sort()).toEqual(managed);
  });

  it('renders the Kizuna logo with the vendor mark as a corner badge', () => {
    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
    const { container } = render(<Icon size={24} />);

    const logo = container.querySelector('img');
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute('alt')).toBe('Kizuna AI');
    // The Kizuna logo is a PNG, so the vendor mark is the only svg here.
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it.each(Object.entries(KIZUNA_HOSTED_ICONS))(
    '%s renders both the Kizuna logo and a vendor badge',
    (_providerId, Icon) => {
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
    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
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
    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
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
    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
    const { container } = render(<Icon size={20} />);

    const mark = container.querySelector('svg') as SVGElement;
    expect(cssPx(mark.style.width)).toBeCloseTo(20 * HOSTED_BADGE_RATIO, 5);
  });

  it('rings the badge so it separates from the logo art behind it', () => {
    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
    const { container } = render(<Icon size={24} />);

    expect(badgeOf(container).style.boxShadow).not.toBe('');
  });

  it('plates a vendor mark that has no background of its own', () => {
    // OpenAI's mark is a transparent `currentColor` glyph and Volcengine's is
    // transparent colored paths; dropped straight onto the Kizuna artwork
    // neither reads. A white plate gives them the same footing as Soniox's
    // own white square.
    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_OPENAI_TRANSLATE];
    const { container } = render(<Icon size={24} />);

    expect(badgeOf(container).style.background).toBe('rgb(255, 255, 255)');
  });

  it('forces a colour onto currentColor marks sitting on the plate', () => {
    // `.provider-icon { color: $text-muted }` cascades into the badge, which
    // would paint OpenAI's glyph #888 on a white plate.
    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_OPENAI_TRANSLATE];
    const { container } = render(<Icon size={24} />);

    const mark = container.querySelector('svg') as SVGElement;
    expect(mark.style.color).toBe('rgb(0, 0, 0)');
  });

  it('leaves a vendor mark that carries its own plate unplated', () => {
    // Soniox's official favicon is already a white rounded square; plating it
    // again would just fatten the white border.
    const Icon = KIZUNA_HOSTED_ICONS[Provider.KIZUNA_AI_SONIOX];
    const { container } = render(<Icon size={24} />);

    expect(badgeOf(container).style.background).toBe('');
  });
});
