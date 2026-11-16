/**
 * What React Grab copies for one element (src/dev/reactGrab.ts): its opening tag with a little of its text,
 * then the components that rendered it, nearest first, each at file:line:column of our source.
 *
 * React Grab maps positions back to our source through source maps it fetches over http(s) only. On the
 * dev server that works. The extension's dev build runs from chrome-extension:// pages, so there a frame
 * still points into the bundle: such a component is named without a location, which still says where it is.
 */

/** A frame of React Grab's `getStack`: the component, and the line in its file where it placed the next one. */
export interface GrabFrame {
  functionName?: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

/** How many of our components the copy names: enough to get from a shared control to the feature that placed it. */
export const MAX_COMPONENTS = 6;
const MAX_TEXT = 40;
const MAX_TAG = 160;

/** A frame mapped back to one of our source files. */
const OUR_SOURCE = /\.tsx?$/;
/** A frame left in the extension's bundle (React Grab could not map it). */
const EXTENSION_BUNDLE = /^chrome-extension:\/\//;

export function describeElement(element: Element, frames: readonly GrabFrame[]): string {
  const lines = [snippet(element)];
  for (const f of frames) {
    if (lines.length > MAX_COMPONENTS) break;
    if (!f.functionName || !f.fileName) continue;
    if (EXTENSION_BUNDLE.test(f.fileName)) {
      // Unmapped: the component's name alone.
      lines.push(`  in ${f.functionName}`);
      continue;
    }
    // React itself and libraries.
    if (!OUR_SOURCE.test(f.fileName)) continue;
    const at = f.lineNumber ? `${f.fileName}:${f.lineNumber}${f.columnNumber ? `:${f.columnNumber}` : ''}` : f.fileName;
    lines.push(`  in ${f.functionName} (at ${at})`);
  }
  return lines.join('\n');
}

/** Elements with no content and no closing tag. */
const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * `<button class="…" type="button">下一步</button>`: the opening tag (shortened when long), up to 40 characters of
 * text. A drop-down shows its selected option, not every option run together.
 */
function snippet(element: Element): string {
  const tag = element.tagName.toLowerCase();
  let open = openingTag(element);
  if (open.length > MAX_TAG) open = `${open.slice(0, MAX_TAG - 2)}…>`;
  if (VOID.has(tag)) return open;
  const raw = element instanceof HTMLSelectElement ? (element.selectedOptions[0]?.textContent ?? '') : (element.textContent ?? '');
  const text = raw.replace(/\s+/g, ' ').trim();
  const shown = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
  return `${open}${shown}</${tag}>`;
}

/**
 * The element's opening tag without a field's `value`. React mirrors a controlled input's value into the
 * attribute, and a password field holds an API key (`CredentialForm`): a bug report must never carry it.
 */
function openingTag(element: Element): string {
  const copy = element.cloneNode(false) as Element;
  if (copy instanceof HTMLInputElement) copy.removeAttribute('value');
  const html = copy.outerHTML;
  return html.slice(0, html.indexOf('>') + 1);
}
