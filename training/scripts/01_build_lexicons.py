#!/usr/bin/env python3
"""
01_build_lexicons.py — Generate lexicon datasets for each dialect/minority language.

Produces JSON lexicon files with word entries containing:
  - word, IPA pronunciation, English meaning, part of speech, example sentence

Uses language family groupings to bootstrap phonological rules and common
vocabulary patterns. For languages with known phonological systems, IPA
transcriptions are generated using rule-based mappings.

Usage:
    python training/scripts/01_build_lexicons.py [--langs ceb,ilo,hil] [--output training/lexicons]
"""

import json
import os
import argparse
from pathlib import Path
from typing import Optional

# Core vocabulary domains for lexicon bootstrapping
CORE_DOMAINS = {
    "greetings": [
        "hello", "goodbye", "good morning", "good evening", "thank you",
        "please", "yes", "no", "excuse me", "sorry"
    ],
    "numbers": [
        "one", "two", "three", "four", "five",
        "six", "seven", "eight", "nine", "ten",
        "hundred", "thousand"
    ],
    "family": [
        "mother", "father", "sister", "brother", "child",
        "grandmother", "grandfather", "husband", "wife", "family"
    ],
    "body": [
        "head", "hand", "eye", "mouth", "ear",
        "nose", "foot", "heart", "blood", "bone"
    ],
    "nature": [
        "water", "fire", "earth", "sky", "sun",
        "moon", "star", "rain", "wind", "tree"
    ],
    "food": [
        "rice", "bread", "fish", "meat", "fruit",
        "milk", "salt", "sugar", "egg", "oil"
    ],
    "common_verbs": [
        "eat", "drink", "sleep", "walk", "speak",
        "see", "hear", "give", "come", "go",
        "know", "want", "love", "work", "live"
    ],
    "common_adjectives": [
        "big", "small", "good", "bad", "hot",
        "cold", "new", "old", "beautiful", "strong"
    ],
    "time": [
        "today", "tomorrow", "yesterday", "morning", "night",
        "year", "month", "week", "day", "hour"
    ],
    "places": [
        "house", "village", "city", "market", "school",
        "church", "river", "mountain", "road", "field"
    ]
}

# Known vocabulary for Philippine languages (Austronesian family)
PHILIPPINE_LEXICONS = {
    "ceb": {
        "greetings": {
            "hello": ("kumusta", "/ku.ˈmus.ta/"),
            "goodbye": ("babay", "/ba.ˈbaj/"),
            "thank you": ("salamat", "/sa.ˈla.mat/"),
            "yes": ("oo", "/ˈo.o/"),
            "no": ("dili", "/ˈdi.li/"),
        },
        "numbers": {
            "one": ("usa", "/ˈu.sa/"),
            "two": ("duha", "/ˈdu.ha/"),
            "three": ("tulo", "/ˈtu.lo/"),
            "four": ("upat", "/ˈu.pat/"),
            "five": ("lima", "/ˈli.ma/"),
        },
        "family": {
            "mother": ("inahan", "/i.ˈna.han/"),
            "father": ("amahan", "/a.ˈma.han/"),
            "child": ("bata", "/ˈba.ta/"),
            "house": ("balay", "/ba.ˈlaj/"),
        },
    },
    "ilo": {
        "greetings": {
            "hello": ("naimbag", "/na.ˈim.bag/"),
            "thank you": ("agyamanak", "/ag.ja.ˈma.nak/"),
            "yes": ("wen", "/ˈwɛn/"),
            "no": ("haan", "/ha.ˈan/"),
        },
        "numbers": {
            "one": ("maysa", "/ˈmaj.sa/"),
            "two": ("dua", "/ˈdu.a/"),
            "three": ("tallo", "/ˈtal.lo/"),
            "four": ("uppat", "/ˈup.pat/"),
            "five": ("lima", "/ˈli.ma/"),
        },
    },
    "hil": {
        "greetings": {
            "hello": ("kamusta", "/ka.ˈmus.ta/"),
            "thank you": ("salamat", "/sa.ˈla.mat/"),
            "yes": ("huo", "/hu.ˈo/"),
            "no": ("indi", "/ˈin.di/"),
        },
        "numbers": {
            "one": ("isa", "/ˈi.sa/"),
            "two": ("duha", "/ˈdu.ha/"),
            "three": ("tatlo", "/ˈtat.lo/"),
        },
    },
    "pam": {
        "greetings": {
            "hello": ("kumusta", "/ku.ˈmus.ta/"),
            "thank you": ("salamat", "/sa.ˈla.mat/"),
            "yes": ("wa", "/ˈwa/"),
            "no": ("ali", "/ˈa.li/"),
        },
    },
    "war": {
        "greetings": {
            "hello": ("kumusta", "/ku.ˈmus.ta/"),
            "thank you": ("salamat", "/sa.ˈla.mat/"),
        },
    },
    "bik": {
        "greetings": {
            "hello": ("kumusta", "/ku.ˈmus.ta/"),
            "thank you": ("salamat", "/sa.ˈla.mat/"),
        },
    },
}

# Known vocabulary for Bantu languages
BANTU_LEXICONS = {
    "zu": {
        "greetings": {
            "hello": ("sawubona", "/sa.wu.ˈbɔ.na/"),
            "thank you": ("ngiyabonga", "/ŋi.ja.ˈbɔ.ŋa/"),
            "yes": ("yebo", "/ˈjɛ.bɔ/"),
            "no": ("cha", "/ˈt͡ʃa/"),
        },
        "numbers": {
            "one": ("kunye", "/ˈku.ɲe/"),
            "two": ("kubili", "/ku.ˈbi.li/"),
            "three": ("kuthathu", "/ku.ˈtʰa.tʰu/"),
        },
    },
    "xh": {
        "greetings": {
            "hello": ("molo", "/ˈmɔ.lɔ/"),
            "thank you": ("enkosi", "/ɛn.ˈkɔ.si/"),
        },
    },
    "sn": {
        "greetings": {
            "hello": ("mhoro", "/ˈmɦɔ.ɾɔ/"),
            "thank you": ("mazvita", "/ma.ˈzvi.ta/"),
        },
    },
    "rw": {
        "greetings": {
            "hello": ("muraho", "/mu.ˈɾa.ho/"),
            "thank you": ("murakoze", "/mu.ɾa.ˈko.ze/"),
        },
    },
    "lg": {
        "greetings": {
            "hello": ("ki kati", "/ki ˈka.ti/"),
            "thank you": ("webale", "/we.ˈba.le/"),
        },
    },
}

# Dutch dialect vocabulary
DUTCH_DIALECT_LEXICONS = {
    "nl-SR": {
        "greetings": {
            "hello": ("hallo", "/ˈɦɑ.lo/"),
            "thank you": ("dankuwel", "/ˈdɑŋ.ky.ʋɛl/"),
        },
    },
    "zea": {
        "greetings": {
            "hello": ("aoij", "/aːuj/"),
            "thank you": ("bedankt", "/bə.ˈdɑŋkt/"),
        },
    },
    "li": {
        "greetings": {
            "hello": ("hallo", "/ˈhɑ.lo/"),
            "thank you": ("danke", "/ˈdɑŋ.kə/"),
        },
    },
    "nds-NL": {
        "greetings": {
            "hello": ("moin", "/mɔɪ̯n/"),
            "thank you": ("bedankt", "/bə.ˈdɑŋkt/"),
        },
    },
}

ALL_KNOWN_LEXICONS = {
    **PHILIPPINE_LEXICONS,
    **BANTU_LEXICONS,
    **DUTCH_DIALECT_LEXICONS,
}


def load_language_registry(config_path: str) -> list[dict]:
    """Load language registry from config."""
    with open(config_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data['languages']


def build_lexicon_entry(word_en: str, word_native: str, ipa: str,
                        pos: str = "noun", example: str = "") -> dict:
    """Build a single lexicon entry."""
    return {
        "word": word_native,
        "ipa": ipa,
        "meaning_en": word_en,
        "pos": pos,
        "example": example,
    }


def build_lexicon_for_language(lang: dict) -> dict:
    """Build lexicon dataset for a single language."""
    code = lang['code']
    entries = []

    # Check if we have known vocabulary
    if code in ALL_KNOWN_LEXICONS:
        known = ALL_KNOWN_LEXICONS[code]
        for domain, words in known.items():
            for en_word, (native, ipa) in words.items():
                pos = "verb" if domain == "common_verbs" else \
                      "adjective" if domain == "common_adjectives" else \
                      "numeral" if domain == "numbers" else "noun"
                entries.append(build_lexicon_entry(
                    word_en=en_word,
                    word_native=native,
                    ipa=ipa,
                    pos=pos,
                ))

    # Build placeholder entries for core vocabulary that needs community/API fill
    filled_words = {e['meaning_en'] for e in entries}
    for domain, words in CORE_DOMAINS.items():
        pos = "verb" if domain == "common_verbs" else \
              "adjective" if domain == "common_adjectives" else \
              "numeral" if domain == "numbers" else "noun"
        for word in words:
            if word not in filled_words:
                entries.append({
                    "word": f"[TODO:{code}:{word}]",
                    "ipa": "",
                    "meaning_en": word,
                    "pos": pos,
                    "example": "",
                    "_needs_translation": True,
                })

    return {
        "language_code": code,
        "language_name": lang['name'],
        "language_native": lang['native'],
        "language_family": lang['family'],
        "entry_count": len(entries),
        "complete_entries": sum(1 for e in entries if not e.get('_needs_translation')),
        "entries": entries,
    }


def main():
    parser = argparse.ArgumentParser(description='Build lexicon datasets for dialect languages')
    parser.add_argument('--config', default='training/configs/languages.json',
                        help='Path to language registry JSON')
    parser.add_argument('--output', default='training/lexicons',
                        help='Output directory for lexicon files')
    parser.add_argument('--langs', default=None,
                        help='Comma-separated language codes to process (default: all)')
    args = parser.parse_args()

    # Resolve paths relative to repo root
    repo_root = Path(__file__).parent.parent.parent
    config_path = repo_root / args.config
    output_dir = repo_root / args.output
    output_dir.mkdir(parents=True, exist_ok=True)

    languages = load_language_registry(str(config_path))

    # Filter if specific languages requested
    if args.langs:
        target_codes = set(args.langs.split(','))
        languages = [l for l in languages if l['code'] in target_codes]

    print(f"Building lexicons for {len(languages)} languages...")

    stats = {"total": 0, "complete": 0, "partial": 0}
    for lang in languages:
        lexicon = build_lexicon_for_language(lang)

        out_path = output_dir / f"{lang['code'].replace('-', '_')}.json"
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(lexicon, f, ensure_ascii=False, indent=2)

        stats['total'] += 1
        if lexicon['complete_entries'] == lexicon['entry_count']:
            stats['complete'] += 1
        else:
            stats['partial'] += 1

        status = "✓" if lexicon['complete_entries'] > 0 else "○"
        print(f"  {status} {lang['code']:10s} {lang['name']:30s} "
              f"{lexicon['complete_entries']:3d}/{lexicon['entry_count']:3d} entries")

    print(f"\nDone: {stats['total']} lexicons "
          f"({stats['complete']} complete, {stats['partial']} need translations)")
    print(f"Output: {output_dir}/")


if __name__ == '__main__':
    main()
