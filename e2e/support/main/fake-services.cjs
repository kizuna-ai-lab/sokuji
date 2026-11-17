// Preloaded into the app's main process (`electron -r`) by the tests that fake a service the main process itself
// calls. The main process takes `fetch` when it starts (the file transcriber does), so it is replaced here, before any
// of the app's code runs. A request goes by its host to the fake service registered for it. Any other request leaving
// the main process is refused and noted, for the test to find: a service no fake answers shows up at once instead of
// reaching the real one.
//
// A fake service is a module with `name` (the service's id in the app's line-up, so two services never share one),
// `handles(url)`, `answer(request, url)` and `control`; `control` is what the test drives (see
// e2e/support/transcription.ts). Plain JavaScript on purpose: it runs as it is, before the app.
'use strict';

const services = [require('./transcription-soniox.cjs')];
const refused = [];
const realFetch = globalThis.fetch;

globalThis.e2eFakes = { refused, services: Object.fromEntries(services.map((s) => [s.name, s.control])) };

globalThis.fetch = async function fetchThroughFakes(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const service = services.find((s) => s.handles(url));
  if (service) return service.answer(request, url);
  // The machine's own, and data: URLs, are not services. (The request built above is what goes on: building it took
  // the body of a Request passed in.)
  if (url.protocol === 'data:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') return realFetch(request);
  refused.push(`${request.method} ${url.origin}${url.pathname}`);
  throw new TypeError(`fetch failed: nothing answers ${url.host} in this test`);
};
