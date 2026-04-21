// BingTranslatorClient — unofficial Bing Translator access.
// Scrapes the /translator HTML for an anti-abuse token, then POSTs to /ttranslatev3.
// Token TTL is 1 hour; we refresh proactively 5 minutes before expiry.

export interface ParsedTranslatorPage {
  ig: string;
  iid: string;
  key: string;
  token: string;
}

export function parseTranslatorPage(html: string): ParsedTranslatorPage {
  const ig = html.match(/IG:"([0-9A-Fa-f]+)"/)?.[1];
  if (!ig) throw new BingTokenFetchError('could not find IG in translator page');

  const iid = html.match(/data-iid="([^"]+)"/)?.[1];
  if (!iid) throw new BingTokenFetchError('could not find IID in translator page');

  const abuseMatch = html.match(
    /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*\d+\s*\]/
  );
  if (!abuseMatch) {
    throw new BingTokenFetchError('could not find token (params_AbusePreventionHelper) in translator page');
  }

  return { ig, iid, key: abuseMatch[1], token: abuseMatch[2] };
}

export class BingTokenFetchError extends Error {
  readonly errorType = 'token' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BingTokenFetchError';
  }
}

export class BingUnsupportedLanguageError extends Error {
  readonly errorType = 'unsupported' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BingUnsupportedLanguageError';
  }
}

export class BingTranslateError extends Error {
  readonly errorType = 'network' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BingTranslateError';
  }
}
