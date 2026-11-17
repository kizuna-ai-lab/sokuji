// The screens added with History (History, its notes, the live notes and the word list) say
// everything in the interface's language, with no English left in them. Checked in Chinese and Japanese; the 30
// locales having the same keys is locales.consistency.test.ts.
import { describe, it, expect } from 'vitest';
import en from './en/translation.json';
import zhCN from './zh_CN/translation.json';
import ja from './ja/translation.json';

type Tree = { [key: string]: string | Tree };
const AREAS = ['history', 'notes', 'notesQuit', 'liveNotes', 'settingsPage.wordList'];
/**
 * Latin text that is not English left over: names of products and services, keyboard keys, file formats, a model's
 * id, and "key", which the Chinese interface uses for an API key throughout (as in "API key").
 */
const KEPT = /\{\{\w+\}\}|<\/?\w+>|Kizuna AI|Sokuji|Soniox|OpenAI( Translate| Live)?|Gemini Live|gemini-[\w.-]+|Palabra|Qwen|Markdown|JSON|Enter|Esc|\.(txt|json|md|opus|srt|vtt)|\bAPI\b|\bkey\b|\b[A-Z]{2,4}\b/g;

function leaves(tree: Tree, prefix: string): Array<[string, string]> {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}
const at = (tree: Tree, key: string): unknown => key.split('.').reduce<unknown>((d, part) => (d && typeof d === 'object' ? (d as Tree)[part] : undefined), tree);

describe('the History screens, in Chinese and Japanese', () => {
  for (const [lang, tree] of [['zh_CN', zhCN], ['ja', ja]] as const) {
    it(`leave no English in ${lang}`, () => {
      const left: string[] = [];
      for (const area of AREAS) {
        for (const [key] of leaves(at(en as Tree, area) as Tree, `${area}.`)) {
          const text = at(tree as Tree, key);
          if (typeof text !== 'string') { left.push(`${key}: missing`); continue; }
          if (/[A-Za-z]{3,}/.test(text.replace(KEPT, ''))) left.push(`${key}: ${text}`);
        }
      }
      expect(left).toEqual([]);
    });
  }
});
