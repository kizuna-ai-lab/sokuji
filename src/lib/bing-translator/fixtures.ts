// Minimal HTML snippets used by BingTranslatorClient tests.
// Based on the shape observed in the proto run against live www.bing.com/translator.

export const VALID_TRANSLATOR_HTML = `
<!DOCTYPE html>
<html><head><title>Bing Translator</title></head>
<body>
  <div data-iid="translator.5025"></div>
  <script>
    var somethingElse = 1;
    var _G = {IG:"00A32DCAFD524DB683556A03ECA7B5B5"};
    var params_AbusePreventionHelper = [ 1776797443746, "LskUa0jCLiMZEc9SdrRoytKgT-3RyAkf", 3600000 ];
  </script>
</body></html>
`.trim();

export const HTML_MISSING_IG = VALID_TRANSLATOR_HTML.replace(/IG:"[0-9A-F]+"/, 'IG:""');
export const HTML_MISSING_IID = VALID_TRANSLATOR_HTML.replace(/data-iid="[^"]+"/, 'data-iid=""');
export const HTML_MISSING_TOKEN = VALID_TRANSLATOR_HTML.replace(/params_AbusePreventionHelper[\s\S]*?\];/, '');
