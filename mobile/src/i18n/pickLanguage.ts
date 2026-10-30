// The catalog for a device's language tags: the first tag that maps to one.
//
// Catalog codes are the desktop's directory names (`ja`, `zh_CN`, `pt_BR`,
// `fil`, …). A tag matches exactly, by script or region for Chinese, by
// `lang_REGION`, by language alone, and last by the language's own-country
// variant (`pt` → `pt_PT`), as the plan spells out; none → `'en'`.
export function pickLanguage(tags: readonly string[], available: readonly string[]): string {
  const has = (code: string) => available.includes(code);
  for (const tag of tags) {
    if (!tag) continue;
    if (has(tag)) return tag;
    const parts = tag.replace(/_/g, '-').split('-');
    const lang = parts[0].toLowerCase();
    const rest = parts.slice(1).map((p) => p.toLowerCase());
    const script = rest.find((p) => p.length === 4);
    const region = rest.find((p) => p.length === 2 || /^\d{3}$/.test(p));
    if (lang === 'zh') {
      const traditional = script === 'hant' || (!script && (region === 'tw' || region === 'hk' || region === 'mo'));
      const code = traditional ? 'zh_TW' : 'zh_CN';
      if (has(code)) return code;
    }
    if (region && has(`${lang}_${region.toUpperCase()}`)) return `${lang}_${region.toUpperCase()}`;
    if (has(lang)) return lang;
    const own = `${lang}_${lang.toUpperCase()}`;
    if (has(own)) return own;
    const regional = available.find((c) => c.toLowerCase().startsWith(`${lang}_`));
    if (regional) return regional;
  }
  return 'en';
}
