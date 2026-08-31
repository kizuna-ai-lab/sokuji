/**
 * Dev-only console filter for two React false positives.
 *
 * The customizable-select markup (<button><selectedcontent/></button> inside
 * <select>, rich spans inside <option>) is valid HTML in Chromium 135+ — the
 * select parser relaxation and appearance: base-select shipped together — but
 * React's validateDOMNesting still enforces the pre-relaxation content model.
 * Verified against react-dom 19.2.8 (latest stable) and the newest 19.3
 * canary (2026-05-29): the `case "select"` whitelist still ends at
 * option/optgroup/hr/script/template/#text and neither build mentions
 * <selectedcontent> at all. Nor does `case "optgroup"`, which still admits
 * only option/#text — so the <legend> that labels a group is a third false
 * positive. Until React catches up, every render of the provider, variant or
 * voice select logs alarming-but-false errors.
 *
 * The "will cause a hydration error" part of the message does not apply
 * either: this app client-renders through createRoot, so no hydration ever
 * happens.
 *
 * validateDOMNesting only exists in development builds — production is
 * untouched — so this filter is dev-only too, and matches as narrowly as the
 * message format allows: exactly the two parent/child pairs our select markup
 * uses on purpose. A genuinely wrong nesting (say, <div> in <option>) still
 * logs. Delete this file when React learns the new select content model.
 */

const MUFFLED_PAIRS: Array<[child: string, parent: string]> = [
  ['<button>', '<select>'],
  ['<span>', '<option>'],
  // <legend> is how a customizable select labels an <optgroup> in a way CSS
  // can reach (the `label` attribute is UA-painted black and unstylable).
  // React's `case "optgroup"` still allows only option/#text — verified in
  // react-dom 19.2.8.
  ['<legend>', '<optgroup>'],
];

/**
 * React logs through a printf-style format string, captured verbatim from a
 * live window: `"In HTML, %s cannot be a child of <%s>.%s\n..."` with the
 * child bracketed ('<button>') but the parent bare ('select') — so naive
 * argument joining never contains '<select>'. Render the format first, then
 * match.
 */
function renderConsoleFormat(args: unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first === 'string' && first.includes('%s')) {
    let i = 0;
    return first.replace(/%s/g, () => String(rest[i++] ?? ''));
  }
  return args.map(String).join(' ');
}

export function installCustomizableSelectWarningMuffler(): void {
  if (!import.meta.env.DEV) return;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    // Only the first line carries the verdict ("In HTML, <x> cannot be a
    // child of <y>."). The component stack that follows routinely contains
    // bare tags like "<span>" or "<option>", which would make a REAL error
    // (say, <div> in <option>) match a muffled pair by accident.
    const text = renderConsoleFormat(args).split('\n', 1)[0];
    if (
      text.includes('cannot be a child of') &&
      MUFFLED_PAIRS.some(([child, parent]) => text.includes(child) && text.includes(parent))
    ) {
      return;
    }
    original.apply(console, args as never[]);
  };
}
