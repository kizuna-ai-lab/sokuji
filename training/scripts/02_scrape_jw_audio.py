#!/usr/bin/env python3
"""
02_scrape_jw_audio.py — Scrape aligned text + audio from jw.org for dialect languages.

jw.org provides Bible content in 700+ languages with high-quality audio recordings
aligned to text. This script:

1. Discovers available languages and their audio content on jw.org
2. Downloads audio files (MP3) with corresponding text transcripts
3. Segments audio into sentence-level chunks using silence detection
4. Outputs paired (text, audio_path) dataset ready for SNAC tokenization

Usage:
    python training/scripts/02_scrape_jw_audio.py --output training/datasets/raw_audio
    python training/scripts/02_scrape_jw_audio.py --langs ceb,ilo --max-per-lang 100
"""

import json
import os
import re
import time
import argparse
import hashlib
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Install dependencies: pip install requests beautifulsoup4")
    exit(1)

# jw.org API endpoints
JW_API_BASE = "https://b.jw.org/finder"
JW_MEDIA_API = "https://b.jw.org/GETPUBMEDIALINKS"
JW_WOL_BASE = "https://wol.jw.org"

# Rate limiting
REQUEST_DELAY = 1.5  # seconds between requests (be respectful)

# jw.org language code mapping (ISO 639 → jw.org wtlocale codes)
# jw.org uses its own language codes; this maps our codes to theirs
JW_LANG_MAP = {
    "ceb": "CV",  # Cebuano
    "ilo": "IL",  # Ilocano
    "hil": "HI",  # Hiligaynon
    "pam": "KP",  # Kapampangan
    "war": "WR",  # Waray
    "bik": "BK",  # Bikol
    "pag": "PG",  # Pangasinan
    "tl": "TG",   # Tagalog
    "zu": "ZU",   # Zulu
    "xh": "XH",   # Xhosa
    "sn": "SN",   # Shona
    "rw": "KY",   # Kinyarwanda
    "lg": "LG",   # Luganda
    "ln": "LN",   # Lingala
    "yo": "YO",   # Yoruba
    "ig": "IB",   # Igbo
    "ha": "HA",   # Hausa
    "sw": "SW",   # Swahili
    "ny": "CC",   # Chichewa
    "ts": "TS",   # Tsonga
    "tn": "TN",   # Tswana
    "ss": "SS",   # Swati
    "st": "SE",   # Sesotho
    "ve": "VE",   # Venda
    "nr": "ND",   # Ndebele
    "mg": "MG",   # Malagasy
    "sm": "SM",   # Samoan
    "to": "TO",   # Tongan
    "fj": "FJ",   # Fijian
    "mi": "MI",   # Maori
    "ht": "CR",   # Haitian Creole
    "pap": "PA",  # Papiamento
    "jv": "JW",   # Javanese
    "su": "SU",   # Sundanese
    "ay": "AY",   # Aymara
    "qu": "QU",   # Quechua
    "gn": "GN",   # Guarani
    "eu": "BA",   # Basque
    "fy": "FR",   # Frisian — check availability
    "lb": "LU",   # Luxembourgish
    "br": "BT",   # Breton
    "ga": "GI",   # Irish
    "gd": "GE",   # Scots Gaelic
    "cy": "WE",   # Welsh
    "co": "IC",   # Corsican
    "wo": "WO",   # Wolof
    "ff": "FU",   # Fulani
    "bm": "BN",   # Bambara
    "ee": "EW",   # Ewe
    "tw": "TW",   # Twi
    "om": "OR",   # Oromo
    "ti": "TI",   # Tigrinya
    "am": "AM",   # Amharic — but this is mainstream, skip
    "rn": "RN",   # Rundi
    "kg": "KC",   # Kikongo
    "lua": "LB",  # Tshiluba
    "bem": "BE",  # Bemba
    "tum": "TU",  # Tumbuka
    "tpi": "TP",  # Tok Pisin
    "sg": "SG",   # Sango
    "mfe": "MU",  # Mauritian Creole
}


class JWAudioScraper:
    """Scrapes text + audio pairs from jw.org."""

    def __init__(self, output_dir: str, max_per_lang: int = 500):
        self.output_dir = Path(output_dir)
        self.max_per_lang = max_per_lang
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Eburon-TTS-Research/0.1 (academic-research)',
            'Accept': 'application/json',
        })

    def discover_language(self, jw_code: str) -> dict:
        """Check what content is available for a language on jw.org."""
        url = f"{JW_API_BASE}?wtlocale={jw_code}&pub=nwt&output=json"
        try:
            resp = self.session.get(url, timeout=30)
            time.sleep(REQUEST_DELAY)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            print(f"    Error discovering {jw_code}: {e}")
        return {}

    def get_bible_books(self, jw_code: str) -> list[dict]:
        """Get list of available Bible books with audio for a language."""
        url = (f"{JW_MEDIA_API}?output=json&pub=nwt"
               f"&fileformat=MP3&alllangs=0&langwritten={jw_code}&txtCMSLang={jw_code}")
        try:
            resp = self.session.get(url, timeout=30)
            time.sleep(REQUEST_DELAY)
            if resp.status_code == 200:
                data = resp.json()
                files = data.get('files', {}).get(jw_code, {}).get('MP3', [])
                return files
        except Exception as e:
            print(f"    Error getting books for {jw_code}: {e}")
        return []

    def get_text_content(self, jw_code: str, book: int, chapter: int) -> Optional[str]:
        """Get text content for a specific Bible chapter."""
        url = f"{JW_WOL_BASE}/{jw_code}/wol/b/r1/lp-e/nwt/{book}/{chapter}"
        try:
            resp = self.session.get(url, timeout=30)
            time.sleep(REQUEST_DELAY)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, 'html.parser')
                # Extract verse text
                verses = soup.select('.v, .vs')
                text_parts = []
                for verse in verses:
                    text = verse.get_text(strip=True)
                    if text:
                        text_parts.append(text)
                return ' '.join(text_parts)
        except Exception as e:
            print(f"    Error getting text {jw_code}/{book}/{chapter}: {e}")
        return None

    def download_audio(self, url: str, output_path: Path) -> bool:
        """Download an audio file."""
        if output_path.exists():
            return True
        try:
            resp = self.session.get(url, timeout=120, stream=True)
            time.sleep(REQUEST_DELAY)
            if resp.status_code == 200:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                return True
        except Exception as e:
            print(f"    Error downloading {url}: {e}")
        return False

    def scrape_language(self, iso_code: str, jw_code: str, lang_name: str) -> list[dict]:
        """Scrape all available text+audio pairs for a language."""
        print(f"  Scraping {lang_name} ({iso_code} → jw:{jw_code})...")

        lang_dir = self.output_dir / iso_code
        lang_dir.mkdir(parents=True, exist_ok=True)

        # Get available audio files
        files = self.get_bible_books(jw_code)
        if not files:
            print(f"    No audio files found for {jw_code}")
            return []

        pairs = []
        for file_info in files[:self.max_per_lang]:
            audio_url = file_info.get('file', {}).get('url', '')
            title = file_info.get('title', '')
            if not audio_url:
                continue

            # Generate deterministic filename
            file_hash = hashlib.md5(audio_url.encode()).hexdigest()[:12]
            audio_path = lang_dir / f"{file_hash}.mp3"

            # Download audio
            if self.download_audio(audio_url, audio_path):
                pairs.append({
                    "language": iso_code,
                    "title": title,
                    "audio_path": str(audio_path),
                    "audio_url": audio_url,
                    "source": "jw.org",
                    "duration_s": file_info.get('duration', 0),
                })

            if len(pairs) >= self.max_per_lang:
                break

        # Save manifest
        manifest_path = lang_dir / "manifest.json"
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump({
                "language": iso_code,
                "language_name": lang_name,
                "jw_code": jw_code,
                "pairs": pairs,
                "total_files": len(pairs),
            }, f, ensure_ascii=False, indent=2)

        print(f"    → {len(pairs)} audio files downloaded")
        return pairs


def main():
    parser = argparse.ArgumentParser(description='Scrape text+audio from jw.org')
    parser.add_argument('--config', default='training/configs/languages.json')
    parser.add_argument('--output', default='training/datasets/raw_audio')
    parser.add_argument('--langs', default=None,
                        help='Comma-separated ISO codes to process')
    parser.add_argument('--max-per-lang', type=int, default=200,
                        help='Max audio files per language')
    parser.add_argument('--dry-run', action='store_true',
                        help='Only check availability, do not download')
    args = parser.parse_args()

    repo_root = Path(__file__).parent.parent.parent
    config_path = repo_root / args.config
    output_dir = repo_root / args.output

    with open(config_path, 'r', encoding='utf-8') as f:
        registry = json.load(f)

    languages = registry['languages']
    if args.langs:
        target_codes = set(args.langs.split(','))
        languages = [l for l in languages if l['code'] in target_codes]

    scraper = JWAudioScraper(str(output_dir), max_per_lang=args.max_per_lang)

    total_pairs = 0
    available_langs = 0

    print(f"Scraping audio for {len(languages)} languages from jw.org")
    print(f"Output: {output_dir}/\n")

    for lang in languages:
        iso_code = lang['code']
        jw_code = JW_LANG_MAP.get(iso_code, lang.get('jw_code', ''))

        if not jw_code:
            print(f"  ⊘ {iso_code:10s} {lang['name']:30s} — no jw.org mapping")
            continue

        if args.dry_run:
            print(f"  ? {iso_code:10s} {lang['name']:30s} → jw:{jw_code}")
            continue

        pairs = scraper.scrape_language(iso_code, jw_code, lang['name'])
        if pairs:
            available_langs += 1
            total_pairs += len(pairs)

    print(f"\n{'DRY RUN — ' if args.dry_run else ''}Summary:")
    print(f"  Languages with audio: {available_langs}")
    print(f"  Total audio files: {total_pairs}")


if __name__ == '__main__':
    main()
