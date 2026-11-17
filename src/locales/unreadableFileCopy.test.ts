// An imported file whose audio cannot be read (ALAC, AC-3 and E-AC-3 among them: the app's Chromium decodes none of
// them, on any platform) is refused with a sentence saying so, and a second one saying what to do: convert it to AAC
// or MP3 and import it again (owner, 2026-11-17). In all 30 interface languages.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = join(__dirname);
const codes = readdirSync(LOCALES).filter((name) => statSync(join(LOCALES, name)).isDirectory()).sort();
const unreadableIn = (code: string): string =>
  JSON.parse(readFileSync(join(LOCALES, code, 'translation.json'), 'utf8')).history.file.failure.UNSUPPORTED;

// Read and checked by hand, one row per language: the sentence that was there before (kept word for word), and the
// word for importing used by the language's own "Import a file".
const WORDING: Record<string, readonly [cannotBeRead: string, importAgain: string]> = {
  ar: ['لا يمكن قراءة صوت هذا الملف.', 'استورده'],
  bn: ['এই ফাইলের অডিও পড়া যাচ্ছে না।', 'আমদানি করুন'],
  de: ['Der Ton dieser Datei kann nicht gelesen werden.', 'importiere'],
  en: ['The audio of this file cannot be read.', 'import it'],
  es: ['No se puede leer el audio de este archivo.', 'impórtalo'],
  fa: ['صدای این فایل خوانده نمی‌شود.', 'وارد کنید'],
  fi: ['Tämän tiedoston ääntä ei voi lukea.', 'tuo se'],
  fil: ['Hindi mabasa ang audio ng file na ito.', 'i-import'],
  fr: ['L’audio de ce fichier ne peut pas être lu.', 'importez-le'],
  he: ['אי אפשר לקרוא את השמע של הקובץ.', 'ייבא'],
  hi: ['इस फ़ाइल का ऑडियो पढ़ा नहीं जा सकता।', 'आयात करें'],
  id: ['Audio file ini tidak dapat dibaca.', 'impor'],
  it: ['L’audio di questo file non è leggibile.', 'importalo'],
  ja: ['このファイルの音声を読み込めません。', '取り込んで'],
  ko: ['이 파일의 오디오를 읽을 수 없습니다.', '가져오세요'],
  ms: ['Audio fail ini tidak boleh dibaca.', 'import'],
  nl: ['Het geluid van dit bestand kan niet worden gelezen.', 'importeer'],
  pl: ['Nie można odczytać dźwięku z tego pliku.', 'zaimportuj'],
  pt_BR: ['Não é possível ler o áudio deste arquivo.', 'importe-o'],
  pt_PT: ['Não é possível ler o áudio deste ficheiro.', 'importe-o'],
  ru: ['Звук этого файла не удаётся прочитать.', 'импортируйте'],
  sv: ['Ljudet i filen kan inte läsas.', 'importera'],
  ta: ['இந்தக் கோப்பின் ஒலியைப் படிக்க முடியவில்லை.', 'இறக்குங்கள்'],
  te: ['ఈ ఫైల్ ఆడియోను చదవలేము.', 'దిగుమతి చేయండి'],
  th: ['อ่านเสียงของไฟล์นี้ไม่ได้', 'นำเข้า'],
  tr: ['Bu dosyanın sesi okunamıyor.', 'içe aktar'],
  uk: ['Звук цього файлу не вдається прочитати.', 'імпортуйте'],
  vi: ['Không đọc được âm thanh của tệp này.', 'nhập lại'],
  zh_CN: ['读不出这个文件的声音。', '导入'],
  zh_TW: ['讀不出這個檔案的聲音。', '匯入'],
};

describe('the line for a file whose audio cannot be read, in every interface language', () => {
  it('covers the 30 interface languages', () => {
    expect(codes).toHaveLength(30);
    expect(codes).toEqual(Object.keys(WORDING).sort());
  });

  it.each(codes)('%s: says the audio cannot be read, then to convert it to AAC or MP3 and import it again', (code) => {
    const [cannotBeRead, importAgain] = WORDING[code];
    const line = unreadableIn(code);
    expect(line.startsWith(cannotBeRead)).toBe(true);
    const hint = line.slice(cannotBeRead.length);
    expect(hint).toContain('AAC');
    expect(hint).toContain('MP3');
    expect(hint).toContain(importAgain);
  });
});
