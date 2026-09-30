import { describe, it, expect } from 'vitest';
import { buildRule, isExtensionPage, OLD_AST2_RULE_ID_MAX, OLD_AST2_RULE_ID_MIN, OLD_LIVE_RULE_ID, ruleIdsFor, ruleProblem, sweepIds, urlFilterFor, WS_RULE_ID_MAX, WS_RULE_ID_MIN } from './wsHeaderRule.js';

const RUNTIME = 'abcdefghijklmnopabcdefghijklmnop';
/** What `chrome.runtime.getURL('')` answers in Chrome. */
const PAGES = `chrome-extension://${RUNTIME}/`;
const LIVE = { host: 'api.openai.com', path: '/v1/live/', set: { Authorization: 'Bearer sk-live' }, remove: ['Origin'] };
/** Dynamic rules as `getDynamicRules()` returns them: the old providers' among them. */
const OLD = [
  { id: 2000, condition: { urlFilter: '||openspeech.bytedance.com' } },
  { id: 3000, condition: { urlFilter: '||speech.platform.bing.com' } },
  { id: 4000, condition: { urlFilter: '||api.openai.com/v1/live/' } },
  { id: 9301, condition: { urlFilter: '||api-edge.cognitive.microsofttranslator.com' } },
];

describe("the extension's generic upgrade header rules (Stage 2 OpenAI Live, ruling 7; choice 3)", () => {
  it('builds a websocket rule for the host and path, setting and removing the headers, scoped to the extension itself, at the first free id of its range', () => {
    expect(urlFilterFor('api.openai.com', '/v1/live/')).toBe('||api.openai.com/v1/live/');
    expect(buildRule(OLD, LIVE, RUNTIME)).toEqual({
      id: WS_RULE_ID_MIN,
      priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Authorization', operation: 'set', value: 'Bearer sk-live' }, { header: 'Origin', operation: 'remove' }],
      },
      condition: { urlFilter: '||api.openai.com/v1/live/', resourceTypes: ['websocket'], initiatorDomains: [RUNTIME] },
    });
  });

  it('reuses the id its host and path already hold, takes the lowest free one otherwise, and has none when the range is full', () => {
    const held = [...OLD, { id: 5000, condition: { urlFilter: '||h.example/a/' } }, { id: 5002, condition: { urlFilter: '||api.openai.com/v1/live/' } }];
    expect(buildRule(held, LIVE, RUNTIME)?.id).toBe(5002);
    expect(buildRule(held, { ...LIVE, path: '/v2/' }, RUNTIME)?.id).toBe(5001);
    const full = Array.from({ length: WS_RULE_ID_MAX - WS_RULE_ID_MIN + 1 }, (_, i) => ({ id: WS_RULE_ID_MIN + i, condition: { urlFilter: `||h${i}.example/` } }));
    expect(buildRule(full, LIVE, RUNTIME)).toBeNull();
  });

  it("finds a host and path's rules to clear, and sweeps every generic rule and the old Live and AST2 rules — never another provider's (Stage 2 OpenAI Live, ruling 11; Stage 2 deletion, ruling C3)", () => {
    const rules = [...OLD, { id: 5000, condition: { urlFilter: '||api.openai.com/v1/live/' } }, { id: 5001, condition: { urlFilter: '||h.example/' } }];
    expect(ruleIdsFor(rules, 'api.openai.com', '/v1/live/')).toEqual([5000]);
    expect(ruleIdsFor(rules, 'api.openai.com', '/v1/')).toEqual([]);
    expect(OLD_LIVE_RULE_ID).toBe(4000);
    expect([OLD_AST2_RULE_ID_MIN, OLD_AST2_RULE_ID_MAX]).toEqual([2000, 2009]);
    expect(sweepIds(rules)).toEqual([2000, 4000, 5000, 5001]);
    expect(sweepIds([{ id: 1999 }, { id: 2003 }, { id: 2009 }, { id: 2010 }])).toEqual([2003, 2009]);
    expect(sweepIds(OLD.filter((r) => r.id !== 2000 && r.id !== 4000))).toEqual([]);
  });

  it('refuses a message that names no rule it would install', () => {
    expect(ruleProblem(LIVE)).toBeNull();
    expect(ruleProblem({ ...LIVE, remove: [] })).toBeNull();
    expect(ruleProblem(undefined)).toBe('host must be a host name');
    expect(ruleProblem({ ...LIVE, host: 'api.openai.com/v1' })).toBe('host must be a host name');
    expect(ruleProblem({ ...LIVE, path: 'v1/live/' })).toBe('path must start with / and hold no filter marks');
    expect(ruleProblem({ ...LIVE, path: '/v1/*' })).toBe('path must start with / and hold no filter marks');
    expect(ruleProblem({ ...LIVE, set: [] })).toBe('set must be an object of headers');
    expect(ruleProblem({ ...LIVE, set: { 'Bad Name': 'x' } })).toBe('set must map header names to values');
    expect(ruleProblem({ ...LIVE, set: { Authorization: 7 } })).toBe('set must map header names to values');
    expect(ruleProblem({ ...LIVE, remove: 'Origin' })).toBe('remove must list header names');
    expect(ruleProblem({ ...LIVE, set: {}, remove: [] })).toBe('the rule sets and removes nothing');
  });

  it("takes a message from the extension's own pages alone: never a content script's, whose sender is a web page", () => {
    expect(isExtensionPage({ id: RUNTIME, url: `${PAGES}fullpage.html` }, RUNTIME, PAGES)).toBe(true);
    expect(isExtensionPage({ id: RUNTIME, url: 'https://meet.google.com/abc', tab: { id: 1 } }, RUNTIME, PAGES)).toBe(false);
    expect(isExtensionPage({ id: 'another', url: `${PAGES}fullpage.html` }, RUNTIME, PAGES)).toBe(false);
    expect(isExtensionPage(undefined, RUNTIME, PAGES)).toBe(false);
    expect(isExtensionPage({ id: RUNTIME, url: `${PAGES}fullpage.html` }, RUNTIME, '')).toBe(false);
  });

  it("reads the pages' base from the browser, assuming no scheme: a browser that serves its pages elsewhere is answered all the same", () => {
    const elsewhere = `extension://${RUNTIME}/`;
    expect(isExtensionPage({ id: RUNTIME, url: `${elsewhere}sidepanel.html` }, RUNTIME, elsewhere)).toBe(true);
    expect(isExtensionPage({ id: RUNTIME, url: `${PAGES}sidepanel.html` }, RUNTIME, elsewhere)).toBe(false);
  });
});
