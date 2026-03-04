# Eburon TTS Training Pipeline

Fine-tune **Orpheus-3B** with **Unsloth** for native multilingual TTS output,
covering 230+ minority/dialect languages with lexicon-grounded translation.

## Directory Structure

```
training/
├── configs/
│   └── languages.json          # Language registry (code, name, jw.org code, family)
├── scripts/
│   ├── 01_build_lexicons.py    # Generate lexicon datasets per dialect
│   ├── 02_scrape_jw_audio.py   # Scrape text+audio from jw.org
│   ├── 03_build_paired_dataset.py  # Pair text↔SNAC audio tokens
│   ├── 04_build_translation_corpus.py  # Build parallel translation pairs
│   └── 05_train_orpheus.py     # Unsloth fine-tuning script
├── lexicons/                   # Generated lexicon JSONs per language
├── datasets/                   # Final HF-compatible datasets
└── README.md
```

## Quick Start

```bash
# 1. Install dependencies
pip install -r training/requirements.txt

# 2. Build lexicons for all dialect languages
python training/scripts/01_build_lexicons.py

# 3. Scrape audio from jw.org
python training/scripts/02_scrape_jw_audio.py --output training/datasets/raw_audio

# 4. Build text↔audio paired dataset (SNAC tokens for Orpheus-3B)
python training/scripts/03_build_paired_dataset.py

# 5. Build translation parallel corpus
python training/scripts/04_build_translation_corpus.py

# 6. Fine-tune with Unsloth
python training/scripts/05_train_orpheus.py
```

## Orpheus-3B SNAC Token Format

Orpheus-3B uses SNAC (multi-scale neural audio codec) tokens. Each audio frame
produces 7 tokens at 3 hierarchical levels:

```
<custom_token_X>  where X = code_value + 10 + (level_offset)
Level 0 (coarse):  offset 0,     codes 0-4095   → tokens 10–4105
Level 1 (mid):     offset 4096,  codes 0-4095   → tokens 4106–8201
Level 2 (fine):    offset 2×4096, codes 0-4095  → tokens 8202–12297
```

The interleaving pattern per frame: `[L0, L1, L2, L2, L1, L2, L2]`

## Dataset Formats

### Lexicon (per language)
```json
{
  "language": "ceb",
  "entries": [
    {
      "word": "balay",
      "ipa": "/ba.laj/",
      "meaning_en": "house",
      "pos": "noun",
      "example": "Nindot ang balay."
    }
  ]
}
```

### Audio Paired Dataset (Parquet)
| text | language | audio_path | snac_tokens | duration_s |
|------|----------|-----------|-------------|------------|

### Translation Corpus (Parquet)
| source_lang | target_lang | source_text | target_text | domain |
|-------------|-------------|-------------|-------------|--------|
