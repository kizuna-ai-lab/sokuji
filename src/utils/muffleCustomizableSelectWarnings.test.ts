import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installCustomizableSelectWarningMuffler } from './muffleCustomizableSelectWarnings';

// vitest runs with DEV=true, so the muffler installs — which is also the only
// environment where React's validateDOMNesting (the source of the false
// positives) exists.

describe('installCustomizableSelectWarningMuffler', () => {
  let original: typeof console.error;
  let sink: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

  beforeEach(() => {
    original = console.error;
    sink = vi.fn<(...args: unknown[]) => void>();
    console.error = sink;
    installCustomizableSelectWarningMuffler();
  });

  afterEach(() => {
    console.error = original;
  });

  it('drops the button-in-select false positive in React\'s exact live format', () => {
    // Captured verbatim from a live window via CDP: the child arg carries
    // brackets, the parent arg does NOT (the format supplies them as <%s>).
    // The first muffler version missed this and matched nothing.
    console.error(
      'In HTML, %s cannot be a child of <%s>.%s\nThis will cause a hydration error.%s',
      '<button>', 'select', '', '\n  ...\n    <MainLayout>\n',
    );
    expect(sink).not.toHaveBeenCalled();
  });

  it('drops the span-in-option false positive', () => {
    console.error(
      'In HTML, %s cannot be a child of <%s>.%s\nThis will cause a hydration error.%s',
      '<span>', 'option', '', '',
    );
    expect(sink).not.toHaveBeenCalled();
  });

  it('still reports a genuinely wrong nesting', () => {
    // <div> in <option> is not part of our select markup — if it ever shows
    // up it is a real bug and must stay visible.
    console.error(
      'In HTML, %s cannot be a child of <%s>.%s\nThis will cause a hydration error.%s',
      '<div>', 'option', '', '',
    );
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('still reports a real error whose component stack happens to mention muffled tags', () => {
    // React appends the component stack as the last format argument, and a
    // stack routinely contains lines like "<span className=..." — so matching
    // the WHOLE rendered text would let a real <div>-in-<option> error be
    // swallowed whenever any <span> appears in the stack. Only the first line
    // carries the actual verdict.
    console.error(
      'In HTML, %s cannot be a child of <%s>.%s\nThis will cause a hydration error.%s',
      '<div>', 'option', '',
      // Prop-less elements render bare in React stacks ("<span>", "<option>"),
      // exactly matching the muffled pair strings.
      '\n  ...\n    <span>\n    <option>\n',
    );
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('leaves unrelated errors alone', () => {
    console.error('boom', new Error('x'));
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
