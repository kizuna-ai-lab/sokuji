#!/usr/bin/env python3
"""
04_build_translation_corpus.py — Build parallel translation corpus for dialect languages.

Creates translation pairs between:
  1. Each dialect ↔ English (anchor language)
  2. Each dialect ↔ related dialects in same family

Sources:
  - Lexicon entries (word-level pairs)
  - jw.org parallel Bible text (sentence-level pairs)
  - Common phrases and greetings

Output: JSONL dataset with (source_lang, target_lang, source_text, target_text, domain)

Usage:
    python training/scripts/04_build_translation_corpus.py
"""

import json
import argparse
from pathlib import Path
from typing import Optional

# Common parallel phrases for bootstrapping (English anchors)
PARALLEL_PHRASES = {
    "greetings": [
        "Hello, how are you?",
        "Good morning.",
        "Good evening.",
        "Thank you very much.",
        "You are welcome.",
        "Please help me.",
        "I am sorry.",
        "Excuse me.",
        "Goodbye, see you later.",
        "Nice to meet you.",
    ],
    "basic_conversation": [
        "What is your name?",
        "My name is...",
        "Where are you from?",
        "I come from...",
        "How much does this cost?",
        "I do not understand.",
        "Can you speak slowly?",
        "Where is the market?",
        "I need help.",
        "Thank you for your help.",
    ],
    "emergency": [
        "I need a doctor.",
        "Please call the police.",
        "Where is the hospital?",
        "This is an emergency.",
        "I am lost.",
    ],
    "daily_life": [
        "The weather is good today.",
        "I am going to the market.",
        "The children are at school.",
        "We eat rice every day.",
        "The water is clean.",
        "The sun is very hot.",
        "It is raining outside.",
        "The village is far from here.",
        "My family is well.",
        "I work in the field.",
    ],
    "numbers_phrases": [
        "I have two children.",
        "There are five people here.",
        "It costs ten dollars.",
        "I am thirty years old.",
        "There are one hundred houses in the village.",
    ],
}

# Known translations for common phrases in dialect languages
KNOWN_TRANSLATIONS = {
    "ceb": {
        "Hello, how are you?": "Kumusta, kumusta ka?",
        "Good morning.": "Maayong buntag.",
        "Thank you very much.": "Salamat kaayo.",
        "Goodbye, see you later.": "Babay, magkita ta.",
        "What is your name?": "Unsa imong ngalan?",
        "I do not understand.": "Wala ko kasabot.",
    },
    "ilo": {
        "Hello, how are you?": "Naimbag, kumusta ka?",
        "Good morning.": "Naimbag a bigat.",
        "Thank you very much.": "Agyamanak unay.",
        "What is your name?": "Anya ti naganmo?",
    },
    "hil": {
        "Hello, how are you?": "Kamusta, kamusta ka?",
        "Good morning.": "Maayong aga.",
        "Thank you very much.": "Salamat gid.",
    },
    "zu": {
        "Hello, how are you?": "Sawubona, unjani?",
        "Good morning.": "Sawubona ekuseni.",
        "Thank you very much.": "Ngiyabonga kakhulu.",
        "What is your name?": "Ngubani igama lakho?",
        "I do not understand.": "Angiqondi.",
    },
    "xh": {
        "Hello, how are you?": "Molo, unjani?",
        "Good morning.": "Molo ngentsasa.",
        "Thank you very much.": "Enkosi kakhulu.",
    },
    "yo": {
        "Hello, how are you?": "Bawo ni, se daadaa ni?",
        "Good morning.": "E kaaro.",
        "Thank you very much.": "E se pupo.",
    },
    "ig": {
        "Hello, how are you?": "Kedu, kedu ka i mere?",
        "Good morning.": "Ụtụtụ ọma.",
        "Thank you very much.": "Daalụ nke ukwuu.",
    },
    "ha": {
        "Hello, how are you?": "Sannu, yaya kake?",
        "Good morning.": "Ina kwana.",
        "Thank you very much.": "Na gode sosai.",
    },
    "rw": {
        "Hello, how are you?": "Muraho, amakuru?",
        "Thank you very much.": "Murakoze cyane.",
    },
    "sn": {
        "Hello, how are you?": "Mhoro, makadii?",
        "Thank you very much.": "Mazvita chaizvo.",
    },
    "lg": {
        "Hello, how are you?": "Ki kati, oli otya?",
        "Thank you very much.": "Webale nnyo.",
    },
    "sm": {
        "Hello, how are you?": "Talofa, o a mai oe?",
        "Thank you very much.": "Faafetai tele lava.",
    },
    "to": {
        "Hello, how are you?": "Mālō e lelei, fēfē hake?",
        "Thank you very much.": "Mālō ʻaupito.",
    },
    "fj": {
        "Hello, how are you?": "Bula, o yadra vakacava?",
        "Thank you very much.": "Vinaka vakalevu.",
    },
    "mi": {
        "Hello, how are you?": "Kia ora, kei te pēhea koe?",
        "Thank you very much.": "Tēnā koe.",
    },
    "ht": {
        "Hello, how are you?": "Bonjou, kijan ou ye?",
        "Thank you very much.": "Mèsi anpil.",
    },
    "pap": {
        "Hello, how are you?": "Bon dia, kon ta bai?",
        "Thank you very much.": "Masha danki.",
    },
    "eu": {
        "Hello, how are you?": "Kaixo, zer moduz?",
        "Thank you very much.": "Eskerrik asko.",
    },
    "br": {
        "Hello, how are you?": "Demat, penaos emañ?",
        "Thank you very much.": "Trugarez bras.",
    },
    "ga": {
        "Hello, how are you?": "Dia dhuit, conas atá tú?",
        "Thank you very much.": "Go raibh maith agat.",
    },
    "cy": {
        "Hello, how are you?": "Helo, sut wyt ti?",
        "Thank you very much.": "Diolch yn fawr.",
    },
    "gd": {
        "Hello, how are you?": "Halò, ciamar a tha thu?",
        "Thank you very much.": "Tapadh leat gu mòr.",
    },
}


def build_lexicon_pairs(lexicon_dir: Path, target_langs: set) -> list[dict]:
    """Build word-level translation pairs from lexicons."""
    pairs = []

    for lexicon_file in sorted(lexicon_dir.glob("*.json")):
        with open(lexicon_file, 'r', encoding='utf-8') as f:
            lexicon = json.load(f)

        lang_code = lexicon['language_code']
        if target_langs and lang_code not in target_langs:
            continue

        for entry in lexicon.get('entries', []):
            if entry.get('_needs_translation'):
                continue

            pairs.append({
                "source_lang": "en",
                "target_lang": lang_code,
                "source_text": entry['meaning_en'],
                "target_text": entry['word'],
                "domain": "lexicon",
                "pos": entry.get('pos', ''),
                "ipa": entry.get('ipa', ''),
            })

    return pairs


def build_phrase_pairs(target_langs: set) -> list[dict]:
    """Build phrase-level translation pairs from known translations."""
    pairs = []

    for lang_code, translations in KNOWN_TRANSLATIONS.items():
        if target_langs and lang_code not in target_langs:
            continue

        for en_phrase, native_phrase in translations.items():
            # Find domain
            domain = "general"
            for d, phrases in PARALLEL_PHRASES.items():
                if en_phrase in phrases:
                    domain = d
                    break

            pairs.append({
                "source_lang": "en",
                "target_lang": lang_code,
                "source_text": en_phrase,
                "target_text": native_phrase,
                "domain": domain,
            })

    return pairs


def build_placeholder_pairs(languages: list[dict], target_langs: set) -> list[dict]:
    """Build placeholder pairs that need community translation."""
    pairs = []

    for lang in languages:
        code = lang['code']
        if target_langs and code not in target_langs:
            continue

        if code in KNOWN_TRANSLATIONS:
            known = set(KNOWN_TRANSLATIONS[code].keys())
        else:
            known = set()

        for domain, phrases in PARALLEL_PHRASES.items():
            for phrase in phrases:
                if phrase not in known:
                    pairs.append({
                        "source_lang": "en",
                        "target_lang": code,
                        "source_text": phrase,
                        "target_text": f"[TODO:{code}]",
                        "domain": domain,
                        "_needs_translation": True,
                    })

    return pairs


def build_tts_instruction_pairs(phrase_pairs: list[dict]) -> list[dict]:
    """Build instruction-style pairs for Orpheus-3B TTS training.

    Format: instruction → spoken text in target language.
    This teaches the model to generate speech from translation instructions.
    """
    samples = []

    for pair in phrase_pairs:
        if pair.get('_needs_translation'):
            continue

        lang = pair['target_lang']
        src = pair['source_text']
        tgt = pair['target_text']

        # Translation + TTS instruction
        samples.append({
            "instruction": f"Translate to {lang} and speak: {src}",
            "input": "",
            "output": tgt,
            "language": lang,
            "task": "translate_and_speak",
        })

        # Direct TTS instruction
        samples.append({
            "instruction": f"Say the following in {lang}:",
            "input": tgt,
            "output": tgt,
            "language": lang,
            "task": "tts",
        })

    return samples


def main():
    parser = argparse.ArgumentParser(description='Build translation parallel corpus')
    parser.add_argument('--config', default='training/configs/languages.json')
    parser.add_argument('--lexicons', default='training/lexicons')
    parser.add_argument('--output', default='training/datasets/translation')
    parser.add_argument('--langs', default=None)
    args = parser.parse_args()

    repo_root = Path(__file__).parent.parent.parent
    config_path = repo_root / args.config
    lexicon_dir = repo_root / args.lexicons
    output_dir = repo_root / args.output
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(config_path, 'r', encoding='utf-8') as f:
        registry = json.load(f)

    target_langs = set()
    if args.langs:
        target_langs = set(args.langs.split(','))

    languages = registry['languages']

    print("Building translation corpus...")

    # 1. Lexicon word pairs
    lexicon_pairs = []
    if lexicon_dir.exists():
        lexicon_pairs = build_lexicon_pairs(lexicon_dir, target_langs)
        print(f"  Lexicon pairs: {len(lexicon_pairs)}")

    # 2. Known phrase pairs
    phrase_pairs = build_phrase_pairs(target_langs)
    print(f"  Known phrase pairs: {len(phrase_pairs)}")

    # 3. Placeholder pairs
    placeholder_pairs = build_placeholder_pairs(languages, target_langs)
    print(f"  Placeholder pairs (need translation): {len(placeholder_pairs)}")

    # 4. TTS instruction pairs
    tts_pairs = build_tts_instruction_pairs(phrase_pairs + lexicon_pairs)
    print(f"  TTS instruction pairs: {len(tts_pairs)}")

    # Save complete pairs
    complete_pairs = [p for p in (lexicon_pairs + phrase_pairs) if not p.get('_needs_translation')]
    all_pairs = lexicon_pairs + phrase_pairs + placeholder_pairs

    # JSONL for complete translation pairs
    complete_path = output_dir / "translation_pairs.jsonl"
    with open(complete_path, 'w', encoding='utf-8') as f:
        for pair in complete_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + '\n')

    # JSONL for pairs needing translation (for community contribution)
    todo_path = output_dir / "translation_todo.jsonl"
    with open(todo_path, 'w', encoding='utf-8') as f:
        for pair in all_pairs:
            if pair.get('_needs_translation'):
                f.write(json.dumps(pair, ensure_ascii=False) + '\n')

    # JSONL for TTS instruction dataset
    tts_path = output_dir / "tts_instructions.jsonl"
    with open(tts_path, 'w', encoding='utf-8') as f:
        for pair in tts_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + '\n')

    # Summary metadata
    meta = {
        "complete_translation_pairs": len(complete_pairs),
        "placeholder_pairs": len(placeholder_pairs),
        "tts_instruction_pairs": len(tts_pairs),
        "languages_with_translations": len(set(p['target_lang'] for p in complete_pairs)),
        "languages_needing_work": len(set(
            p['target_lang'] for p in all_pairs if p.get('_needs_translation')
        )),
    }
    with open(output_dir / "metadata.json", 'w') as f:
        json.dump(meta, f, indent=2)

    print(f"\nOutputs:")
    print(f"  {complete_path} ({len(complete_pairs)} pairs)")
    print(f"  {todo_path} ({len(placeholder_pairs)} pairs need community translation)")
    print(f"  {tts_path} ({len(tts_pairs)} TTS instruction pairs)")
    print(f"\nLanguages with translations: {meta['languages_with_translations']}")
    print(f"Languages needing work: {meta['languages_needing_work']}")


if __name__ == '__main__':
    main()
