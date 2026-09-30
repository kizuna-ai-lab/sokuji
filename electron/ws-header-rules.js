// electron/ws-header-rules.js
//
// The WebSocket upgrade header rules the renderer registers over IPC
// ('ws-headers-set' / 'ws-headers-clear') and main's one onBeforeSendHeaders
// listener applies to the next upgrade they match. A browser cannot set an
// upgrade's headers itself: Edge TTS needs a User-Agent, the old Doubao AST 2.0
// client its credentials, and OpenAI Live a real Authorization and no Origin.
//
// A rule is keyed by host and path (Stage 2 OpenAI Live, ruling 7; choice 2):
// it applies to an upgrade to its host whose path starts with the rule's path,
// the longest such path winning, and a rule with no path applies to every path
// on its host, as every rule did before — so Edge TTS and the old AST2 client
// keep working unchanged. A Live rule under /v1/live/ therefore never reaches
// OpenAI Realtime's /v1/realtime or Translate's /v1/realtime/translations on
// the same host. A rule is one-shot: the upgrade it applies to consumes it.

/** A rule's key in the map: its host and its path, '' for every path. */
const keyOf = (host, path) => `${host}\u0000${path}`;

function createWsHeaderRules() {
  // key → { host, path, set: Map<name, value>, remove: Set<lowercased name> }
  const rules = new Map();

  /**
   * Registers a rule: `host` and a `headers` object are required; `path`, when
   * given, starts with '/'; `removeHeaders` names headers to strip from the
   * same upgrade, case-insensitively. Values are coerced to strings —
   * Chromium silently drops a header with a non-string value, and IPC can
   * turn a numeric string into a number — and a null or empty value is
   * dropped. A rule for the same host and path replaces it.
   */
  function set(args) {
    const { host, path, headers, removeHeaders } = args || {};
    if (!host || typeof host !== 'string' || !headers || typeof headers !== 'object') {
      return { success: false, error: 'Invalid arguments: host and headers required' };
    }
    if (path !== undefined && path !== '' && (typeof path !== 'string' || !path.startsWith('/'))) {
      return { success: false, error: 'Invalid arguments: path must start with /' };
    }
    const setHeaders = new Map(
      Object.entries(headers)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    );
    const remove = new Set(
      (Array.isArray(removeHeaders) ? removeHeaders : [])
        .filter((n) => typeof n === 'string' && n.trim() !== '')
        .map((n) => n.trim().toLowerCase()),
    );
    const rulePath = path || '';
    rules.set(keyOf(host, rulePath), { host, path: rulePath, set: setHeaders, remove });
    return { success: true };
  }

  /** Removes the rule for `host` and `path` ('' or absent: the host-wide one), if it is still there. */
  function clear(args) {
    const { host, path } = args || {};
    if (!host) return { success: false, error: 'Invalid arguments: host required' };
    rules.delete(keyOf(host, path || ''));
    return { success: true };
  }

  /**
   * Applies the rule an upgrade to `url` takes — its host's, the longest path
   * that prefixes the URL's path — to `requestHeaders`, and consumes it. The
   * header names and values of every other rule stay. Returns whether one
   * applied; a malformed URL takes none.
   */
  function take(url, requestHeaders) {
    let target;
    try {
      target = new URL(url);
    } catch {
      return false;
    }
    let best = null;
    for (const rule of rules.values()) {
      if (rule.host !== target.host) continue;
      if (rule.path && !target.pathname.startsWith(rule.path)) continue;
      if (!best || rule.path.length > best.path.length) best = rule;
    }
    if (!best) return false;
    if (best.remove.size > 0) {
      for (const name of Object.keys(requestHeaders)) {
        if (best.remove.has(name.toLowerCase())) delete requestHeaders[name];
      }
    }
    for (const [name, value] of best.set.entries()) requestHeaders[name] = value;
    rules.delete(keyOf(best.host, best.path));
    return true;
  }

  return {
    set,
    clear,
    take,
    /** How many rules wait for their upgrade: for tests. */
    get size() {
      return rules.size;
    },
  };
}

module.exports = { createWsHeaderRules };
