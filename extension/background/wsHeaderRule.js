// extension/background/wsHeaderRule.js
//
// The WebSocket upgrade header rules the background installs for the
// extension's own pages (`WS_HEADERS_SET` / `WS_HEADERS_CLEAR`), as pure
// functions: a declarativeNetRequest dynamic rule per host and path, the
// headers set and removed, scoped to websocket upgrades the extension itself
// makes (`initiatorDomains`), in an id range of their own (Stage 2 OpenAI
// Live, ruling 7; choice 3). OpenAI Live is the first user: a real
// Authorization and no Origin, which every browser adds and its endpoint
// answers with 403. The old per-provider pairs stay until their clients go.
// No chrome.* here: background.js reads the rules, hands in the extension's id
// and its pages' base URL, and applies what these return.

/** The range the generic rules live in: a rule a crash left behind is found here, and nothing else is touched. */
export const WS_RULE_ID_MIN = 5000;
export const WS_RULE_ID_MAX = 5099;

/** An HTTP header name (RFC 9110 `token`). */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HOST = /^[A-Za-z0-9.-]+(:\d+)?$/;

/** The rule's URL filter: its host, anchored at a domain boundary, and the path under it. */
export function urlFilterFor(host, path) {
  return `||${host}${path}`;
}

/** Why a message names no rule this background will install, or null: a host, a path under it, and headers set or removed by name. */
export function ruleProblem(message) {
  const { host, path, set, remove } = message || {};
  if (typeof host !== 'string' || !HOST.test(host)) return 'host must be a host name';
  if (typeof path !== 'string' || !path.startsWith('/') || /[*|^]/.test(path)) return 'path must start with / and hold no filter marks';
  if (!set || typeof set !== 'object' || Array.isArray(set)) return 'set must be an object of headers';
  for (const [name, value] of Object.entries(set)) {
    if (!TOKEN.test(name) || typeof value !== 'string' || value === '') return 'set must map header names to values';
  }
  if (!Array.isArray(remove) || remove.some((name) => typeof name !== 'string' || !TOKEN.test(name))) return 'remove must list header names';
  if (Object.keys(set).length === 0 && remove.length === 0) return 'the rule sets and removes nothing';
  return null;
}

/**
 * The old OpenAI Live client's rule (`OPENAI_LIVE_DNR_RULE_ID` in
 * background.js): the same filter, the same initiator. One its client left
 * behind would hold an old key and reach the new upgrade, so the sweep takes it
 * too (Stage 2 OpenAI Live, ruling 11).
 */
export const OLD_LIVE_RULE_ID = 4000;

const inRange = (rule) => rule.id >= WS_RULE_ID_MIN && rule.id <= WS_RULE_ID_MAX;

/** The generic rules' ids for this host and path: what a clear removes. */
export function ruleIdsFor(existing, host, path) {
  const filter = urlFilterFor(host, path);
  return existing.filter((r) => inRange(r) && r.condition?.urlFilter === filter).map((r) => r.id);
}

/** Every generic rule's id, and the old Live rule's: what the sweep at a start removes. */
export function sweepIds(existing) {
  return existing.filter((r) => inRange(r) || r.id === OLD_LIVE_RULE_ID).map((r) => r.id);
}

/**
 * The rule for `message`, under the id its host and path already hold, else
 * the lowest free one in the range; null when the range is full. Scoped to
 * websocket upgrades the extension's own pages make: while it is installed, no
 * other page opening a socket to the host gets its headers.
 */
export function buildRule(existing, message, runtimeId) {
  const filter = urlFilterFor(message.host, message.path);
  const held = existing.find((r) => inRange(r) && r.condition?.urlFilter === filter);
  let id = held?.id;
  if (id === undefined) {
    const taken = new Set(existing.filter(inRange).map((r) => r.id));
    for (let candidate = WS_RULE_ID_MIN; candidate <= WS_RULE_ID_MAX; candidate++) {
      if (!taken.has(candidate)) {
        id = candidate;
        break;
      }
    }
  }
  if (id === undefined) return null;
  return {
    id,
    // Above the old Live rule (4000) at the same filter (`||api.openai.com/v1/live/`), so a leftover of it — left by a client
    // now unreachable — never supplies the key; nothing else competes at this filter (Stage 2 OpenAI Live, ruling 11).
    priority: 2,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        ...Object.entries(message.set).map(([header, value]) => ({ header, operation: 'set', value })),
        ...message.remove.map((header) => ({ header, operation: 'remove' })),
      ],
    },
    condition: { urlFilter: filter, resourceTypes: ['websocket'], initiatorDomains: [runtimeId] },
  };
}

/**
 * A message from one of the extension's own pages — the side panel, the full
 * page — never a content script's, whose sender is a web page. `pageBase` is
 * `chrome.runtime.getURL('')`, so no browser's scheme is assumed.
 */
export function isExtensionPage(sender, runtimeId, pageBase) {
  return !!sender && sender.id === runtimeId && typeof pageBase === 'string' && pageBase !== '' && typeof sender.url === 'string' && sender.url.startsWith(pageBase);
}
