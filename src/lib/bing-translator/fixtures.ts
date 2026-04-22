// Minimal HTML snippets used by BingTranslatorClient tests.
// Placeholder values only — the live token format is hex + opaque base64-ish.
// Do not paste real values into this file; secret scanners may flag them.

export const FIXTURE_IG = '00000000000000000000000000000000';
export const FIXTURE_IID = 'translator.0000';
export const FIXTURE_KEY = '1000000000000';
export const FIXTURE_TOKEN = 'TEST_TOKEN_DO_NOT_USE';

export const VALID_TRANSLATOR_HTML = `
<!DOCTYPE html>
<html><head><title>Bing Translator</title></head>
<body>
  <div data-iid="${FIXTURE_IID}"></div>
  <script>
    var somethingElse = 1;
    var _G = {IG:"${FIXTURE_IG}"};
    var params_AbusePreventionHelper = [ ${FIXTURE_KEY}, "${FIXTURE_TOKEN}", 3600000 ];
  </script>
</body></html>
`.trim();

export const HTML_MISSING_IG = VALID_TRANSLATOR_HTML.replace(/IG:"[0-9A-F]+"/, 'IG:""');
export const HTML_MISSING_IID = VALID_TRANSLATOR_HTML.replace(/data-iid="[^"]+"/, 'data-iid=""');
export const HTML_MISSING_TOKEN = VALID_TRANSLATOR_HTML.replace(/params_AbusePreventionHelper[\s\S]*?\];/, '');
