#!/usr/bin/env python3
"""
03_build_paired_dataset.py — Build text↔SNAC audio token pairs for Orpheus-3B.

Takes raw audio + text from the scraper output and:
1. Resamples audio to 24kHz mono (SNAC requirement)
2. Encodes audio to SNAC tokens using the SNAC codec
3. Interleaves tokens in Orpheus-3B format: [L0, L1, L2, L2, L1, L2, L2] per frame
4. Outputs HuggingFace-compatible dataset (Parquet)

Orpheus-3B SNAC Token Format:
  - 3 hierarchical levels (coarse → fine)
  - Level 0: 1 code/frame  (codes 0-4095)  → custom_token_{10 + code}
  - Level 1: 2 codes/frame  (codes 0-4095)  → custom_token_{4106 + code}
  - Level 2: 4 codes/frame  (codes 0-4095)  → custom_token_{8202 + code}
  - Interleave pattern: [L0_0, L1_0, L2_0, L2_1, L1_1, L2_2, L2_3]

Usage:
    python training/scripts/03_build_paired_dataset.py
    python training/scripts/03_build_paired_dataset.py --input training/datasets/raw_audio --output training/datasets/paired
"""

import json
import os
import argparse
from pathlib import Path
from typing import Optional

try:
    import torch
    import torchaudio
except ImportError:
    torch = None
    torchaudio = None
    print("Warning: torch/torchaudio not available. Install: pip install torch torchaudio")

try:
    from snac import SNAC
except ImportError:
    SNAC = None
    print("Warning: SNAC not available. Install: pip install snac")

# SNAC token encoding offsets for Orpheus-3B
SNAC_OFFSETS = {
    0: 10,      # Level 0 (coarse): tokens 10-4105
    1: 4106,    # Level 1 (mid):    tokens 4106-8201
    2: 8202,    # Level 2 (fine):   tokens 8202-12297
}

SNAC_SAMPLE_RATE = 24000  # SNAC expects 24kHz
MAX_AUDIO_DURATION = 30.0  # Max 30s per sample


class SNACTokenizer:
    """Encodes audio to SNAC tokens in Orpheus-3B format."""

    def __init__(self, device: str = "cpu"):
        self.device = device
        self.model = None

    def load_model(self):
        """Load SNAC model (lazy init)."""
        if self.model is not None:
            return
        if SNAC is None:
            raise RuntimeError("SNAC not installed. Run: pip install snac")
        print("Loading SNAC model...")
        self.model = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").to(self.device)
        self.model.eval()
        print("SNAC model loaded.")

    def load_audio(self, audio_path: str) -> Optional[torch.Tensor]:
        """Load and preprocess audio file to 24kHz mono."""
        if torchaudio is None:
            return None
        try:
            waveform, sr = torchaudio.load(audio_path)

            # Convert to mono
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)

            # Resample to 24kHz
            if sr != SNAC_SAMPLE_RATE:
                resampler = torchaudio.transforms.Resample(sr, SNAC_SAMPLE_RATE)
                waveform = resampler(waveform)

            # Trim to max duration
            max_samples = int(MAX_AUDIO_DURATION * SNAC_SAMPLE_RATE)
            if waveform.shape[1] > max_samples:
                waveform = waveform[:, :max_samples]

            # Normalize
            waveform = waveform / (waveform.abs().max() + 1e-8)

            return waveform
        except Exception as e:
            print(f"    Error loading audio {audio_path}: {e}")
            return None

    def encode(self, waveform: torch.Tensor) -> list[int]:
        """Encode waveform to SNAC tokens in Orpheus-3B interleaved format."""
        self.load_model()

        with torch.no_grad():
            waveform = waveform.unsqueeze(0).to(self.device)
            codes = self.model.encode(waveform)

            # codes is a list of 3 tensors (one per level)
            # Level 0: [1, 1, T/8]   — 1 code per 8ms frame
            # Level 1: [1, 1, T/4]   — 2 codes per frame
            # Level 2: [1, 1, T/2]   — 4 codes per frame
            level0 = codes[0].squeeze().tolist()
            level1 = codes[1].squeeze().tolist()
            level2 = codes[2].squeeze().tolist()

        # Interleave in Orpheus-3B pattern
        tokens = []
        n_frames = len(level0)
        for i in range(n_frames):
            # [L0, L1, L2, L2, L1, L2, L2]
            l0_idx = i
            l1_idx_0 = i * 2
            l1_idx_1 = i * 2 + 1
            l2_idx_0 = i * 4
            l2_idx_1 = i * 4 + 1
            l2_idx_2 = i * 4 + 2
            l2_idx_3 = i * 4 + 3

            if (l1_idx_1 < len(level1) and l2_idx_3 < len(level2)):
                tokens.extend([
                    level0[l0_idx] + SNAC_OFFSETS[0],
                    level1[l1_idx_0] + SNAC_OFFSETS[1],
                    level2[l2_idx_0] + SNAC_OFFSETS[2],
                    level2[l2_idx_1] + SNAC_OFFSETS[2],
                    level1[l1_idx_1] + SNAC_OFFSETS[1],
                    level2[l2_idx_2] + SNAC_OFFSETS[2],
                    level2[l2_idx_3] + SNAC_OFFSETS[2],
                ])

        return tokens

    def tokens_to_string(self, tokens: list[int]) -> str:
        """Convert SNAC token IDs to Orpheus-3B custom_token string format."""
        return ''.join(f'<custom_token_{t}>' for t in tokens)


def process_language(tokenizer: SNACTokenizer, lang_dir: Path) -> list[dict]:
    """Process all audio files for a single language."""
    manifest_path = lang_dir / "manifest.json"
    if not manifest_path.exists():
        return []

    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    results = []
    for pair in manifest.get('pairs', []):
        audio_path = pair.get('audio_path', '')
        if not audio_path or not os.path.exists(audio_path):
            continue

        # Load audio
        waveform = tokenizer.load_audio(audio_path)
        if waveform is None:
            continue

        duration = waveform.shape[1] / SNAC_SAMPLE_RATE

        # Encode to SNAC tokens
        try:
            snac_tokens = tokenizer.encode(waveform)
        except Exception as e:
            print(f"    Error encoding {audio_path}: {e}")
            continue

        results.append({
            "text": pair.get('title', ''),
            "language": pair.get('language', ''),
            "audio_path": audio_path,
            "snac_tokens": snac_tokens,
            "snac_token_string": tokenizer.tokens_to_string(snac_tokens),
            "duration_s": round(duration, 2),
            "n_frames": len(snac_tokens) // 7,
            "source": "jw.org",
        })

    return results


def build_orpheus_training_sample(entry: dict) -> dict:
    """Format a single entry as an Orpheus-3B training sample.

    Orpheus-3B expects:
      - system prompt identifying the task
      - user prompt with text + language
      - assistant response with SNAC tokens
    """
    lang = entry['language']
    text = entry['text']

    return {
        "conversations": [
            {
                "role": "system",
                "content": (
                    f"You are Eburon, a multilingual speech synthesis model. "
                    f"Convert the given text to natural speech in {lang}. "
                    f"Output audio tokens directly."
                ),
            },
            {
                "role": "user",
                "content": f"[{lang}] {text}",
            },
            {
                "role": "assistant",
                "content": entry['snac_token_string'],
            },
        ],
        "language": lang,
        "duration_s": entry['duration_s'],
        "n_audio_tokens": len(entry['snac_tokens']),
    }


def main():
    parser = argparse.ArgumentParser(description='Build text↔SNAC paired dataset')
    parser.add_argument('--input', default='training/datasets/raw_audio',
                        help='Input directory with scraped audio')
    parser.add_argument('--output', default='training/datasets/paired',
                        help='Output directory for paired dataset')
    parser.add_argument('--device', default='cpu',
                        help='Device for SNAC encoding (cpu/cuda/mps)')
    parser.add_argument('--langs', default=None,
                        help='Comma-separated language codes')
    args = parser.parse_args()

    repo_root = Path(__file__).parent.parent.parent
    input_dir = repo_root / args.input
    output_dir = repo_root / args.output
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}")
        print("Run 02_scrape_jw_audio.py first.")
        return

    tokenizer = SNACTokenizer(device=args.device)

    # Process each language directory
    all_samples = []
    lang_dirs = sorted(input_dir.iterdir())

    if args.langs:
        target_codes = set(args.langs.split(','))
        lang_dirs = [d for d in lang_dirs if d.name in target_codes]

    for lang_dir in lang_dirs:
        if not lang_dir.is_dir():
            continue

        print(f"Processing {lang_dir.name}...")
        entries = process_language(tokenizer, lang_dir)

        # Convert to training format
        for entry in entries:
            sample = build_orpheus_training_sample(entry)
            all_samples.append(sample)

        print(f"  → {len(entries)} paired samples")

    # Save as JSONL (compatible with HuggingFace datasets + Unsloth)
    output_path = output_dir / "orpheus_tts_train.jsonl"
    with open(output_path, 'w', encoding='utf-8') as f:
        for sample in all_samples:
            f.write(json.dumps(sample, ensure_ascii=False) + '\n')

    # Save metadata
    meta_path = output_dir / "metadata.json"
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump({
            "total_samples": len(all_samples),
            "format": "orpheus-3b-snac",
            "snac_model": "hubertsiuzdak/snac_24khz",
            "token_offsets": SNAC_OFFSETS,
            "interleave_pattern": "[L0, L1, L2, L2, L1, L2, L2]",
            "languages": list(set(s['language'] for s in all_samples)),
        }, f, indent=2)

    print(f"\nDataset saved: {output_path}")
    print(f"Total samples: {len(all_samples)}")


if __name__ == '__main__':
    main()
