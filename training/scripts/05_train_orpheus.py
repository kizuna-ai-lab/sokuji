#!/usr/bin/env python3
"""
05_train_orpheus.py — Fine-tune Orpheus-3B with Unsloth for native multilingual TTS.

This script uses Unsloth's 4-bit quantized training to fine-tune the Orpheus-3B
speech synthesis model on the SNAC-tokenized multilingual dataset.

Architecture:
  - Base model: canopylabs/orpheus-3b-0.1-pretrained (Llama-based, 3B params)
  - Tokenizer: Extended with SNAC audio tokens (custom_token_0 .. custom_token_12295)
  - Training: LoRA (rank 64) on attention + MLP layers
  - Input: Text instructions → Output: SNAC audio token sequences
  - Audio codec: SNAC 24kHz with 3 hierarchical VQ levels

SNAC Token Layout (Orpheus-3B convention):
  - Level 0: token IDs 10 .. 4105       (4096 codes, coarsest)
  - Level 1: token IDs 4106 .. 8201     (4096 codes, middle)
  - Level 2: token IDs 8202 .. 12297    (4096 codes, finest)
  - Interleave: [L0, L1, L2, L2, L1, L2, L2] per frame (7 tokens)

Usage:
    # Basic training
    python training/scripts/05_train_orpheus.py

    # Custom config
    python training/scripts/05_train_orpheus.py \\
        --dataset training/datasets/snac_paired/combined.jsonl \\
        --output training/checkpoints/orpheus-multilingual \\
        --epochs 3 --batch-size 2 --lr 2e-4

    # Resume from checkpoint
    python training/scripts/05_train_orpheus.py --resume training/checkpoints/orpheus-multilingual/checkpoint-1000

Requirements:
    pip install unsloth[colab-new] datasets transformers trl peft accelerate bitsandbytes
"""

import json
import argparse
import os
from pathlib import Path


def get_training_args():
    parser = argparse.ArgumentParser(description='Fine-tune Orpheus-3B with Unsloth')
    parser.add_argument('--model', default='canopylabs/orpheus-3b-0.1-pretrained',
                        help='Base model name or path')
    parser.add_argument('--dataset', default='training/datasets/snac_paired/combined.jsonl',
                        help='Path to SNAC paired JSONL dataset')
    parser.add_argument('--translation-dataset', default='training/datasets/translation/tts_instructions.jsonl',
                        help='Path to TTS instruction dataset')
    parser.add_argument('--output', default='training/checkpoints/orpheus-multilingual',
                        help='Output directory for checkpoints')
    parser.add_argument('--epochs', type=int, default=3)
    parser.add_argument('--batch-size', type=int, default=2,
                        help='Per-device train batch size')
    parser.add_argument('--grad-accum', type=int, default=4,
                        help='Gradient accumulation steps')
    parser.add_argument('--lr', type=float, default=2e-4,
                        help='Learning rate')
    parser.add_argument('--max-seq-len', type=int, default=8192,
                        help='Maximum sequence length')
    parser.add_argument('--lora-rank', type=int, default=64)
    parser.add_argument('--lora-alpha', type=int, default=128)
    parser.add_argument('--resume', default=None,
                        help='Resume from checkpoint path')
    parser.add_argument('--push-to-hub', default=None,
                        help='HuggingFace repo to push model')
    parser.add_argument('--save-steps', type=int, default=500)
    parser.add_argument('--eval-steps', type=int, default=250)
    parser.add_argument('--warmup-steps', type=int, default=100)
    parser.add_argument('--logging-steps', type=int, default=10)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--bf16', action='store_true', default=True)
    parser.add_argument('--eval-split', type=float, default=0.02,
                        help='Fraction of data for evaluation')
    return parser.parse_args()


def load_and_prepare_model(args):
    """Load Orpheus-3B with Unsloth 4-bit quantization and attach LoRA."""
    from unsloth import FastLanguageModel

    print(f"Loading model: {args.model}")
    print(f"  Max sequence length: {args.max_seq_len}")
    print(f"  LoRA rank: {args.lora_rank}, alpha: {args.lora_alpha}")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq_len,
        dtype=None,  # auto-detect
        load_in_4bit=True,
        trust_remote_code=True,
    )

    # Verify SNAC tokens exist in vocabulary
    snac_token_count = sum(
        1 for i in range(12298)
        if f"<custom_token_{i}>" in tokenizer.get_vocab()
    )
    print(f"  SNAC tokens in vocabulary: {snac_token_count}")

    if snac_token_count == 0:
        print("  WARNING: No SNAC tokens found. Adding custom tokens...")
        new_tokens = [f"<custom_token_{i}>" for i in range(12298)]
        tokenizer.add_tokens(new_tokens)
        model.resize_token_embeddings(len(tokenizer))
        print(f"  Added {len(new_tokens)} tokens. New vocab size: {len(tokenizer)}")

    # Attach LoRA adapters
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_rank,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=args.seed,
    )

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"  Trainable parameters: {trainable:,} / {total:,} ({100*trainable/total:.2f}%)")

    return model, tokenizer


def load_dataset(args):
    """Load and prepare training dataset from JSONL files."""
    from datasets import Dataset, concatenate_datasets

    datasets_to_merge = []

    # Load SNAC paired dataset (audio token targets)
    snac_path = Path(args.dataset)
    if snac_path.exists():
        print(f"Loading SNAC dataset: {snac_path}")
        records = []
        with open(snac_path, 'r', encoding='utf-8') as f:
            for line in f:
                data = json.loads(line)
                records.append(data)
        if records:
            ds = Dataset.from_list(records)
            datasets_to_merge.append(ds)
            print(f"  SNAC samples: {len(ds)}")

    # Load TTS instruction dataset
    tts_path = Path(args.translation_dataset)
    if tts_path.exists():
        print(f"Loading TTS instruction dataset: {tts_path}")
        records = []
        with open(tts_path, 'r', encoding='utf-8') as f:
            for line in f:
                data = json.loads(line)
                # Convert instruction format to conversation format
                records.append({
                    "messages": [
                        {"role": "system", "content": "You are a multilingual speech synthesis model."},
                        {"role": "user", "content": data.get('instruction', '') + (' ' + data['input'] if data.get('input') else '')},
                        {"role": "assistant", "content": data['output']},
                    ],
                    "language": data.get('language', 'unknown'),
                    "task": data.get('task', 'tts'),
                })
        if records:
            ds = Dataset.from_list(records)
            datasets_to_merge.append(ds)
            print(f"  TTS instruction samples: {len(ds)}")

    if not datasets_to_merge:
        raise FileNotFoundError(
            f"No datasets found at {args.dataset} or {args.translation_dataset}. "
            "Run scripts 01-04 first."
        )

    # Merge all datasets
    if len(datasets_to_merge) == 1:
        dataset = datasets_to_merge[0]
    else:
        # Ensure consistent columns
        all_cols = set()
        for ds in datasets_to_merge:
            all_cols.update(ds.column_names)

        aligned = []
        for ds in datasets_to_merge:
            missing = all_cols - set(ds.column_names)
            if missing:
                for col in missing:
                    ds = ds.add_column(col, [None] * len(ds))
            aligned.append(ds)
        dataset = concatenate_datasets(aligned)

    dataset = dataset.shuffle(seed=args.seed)
    print(f"\nTotal training samples: {len(dataset)}")

    return dataset


def format_for_training(example, tokenizer):
    """Format a dataset example into tokenized training input.

    Supports two formats:
    1. Conversation format with 'messages' key (chat template)
    2. Raw 'text' field (pre-formatted)
    """
    if 'messages' in example and example['messages']:
        messages = example['messages']
        if isinstance(messages, str):
            messages = json.loads(messages)
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
    elif 'text' in example:
        text = example['text']
    else:
        text = ""

    return {"text": text}


def train(args):
    """Main training loop."""
    from trl import SFTTrainer
    from transformers import TrainingArguments
    from unsloth import FastLanguageModel

    model, tokenizer = load_and_prepare_model(args)
    dataset = load_dataset(args)

    # Format dataset
    print("Formatting dataset for training...")
    formatted = dataset.map(
        lambda ex: format_for_training(ex, tokenizer),
        remove_columns=[c for c in dataset.column_names if c != 'text'],
        desc="Formatting",
    )

    # Train/eval split
    if args.eval_split > 0:
        split = formatted.train_test_split(test_size=args.eval_split, seed=args.seed)
        train_dataset = split['train']
        eval_dataset = split['test']
        print(f"Train: {len(train_dataset)}, Eval: {len(eval_dataset)}")
    else:
        train_dataset = formatted
        eval_dataset = None

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_steps=args.warmup_steps,
        weight_decay=0.01,
        bf16=args.bf16,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        eval_steps=args.eval_steps if eval_dataset else None,
        eval_strategy="steps" if eval_dataset else "no",
        save_total_limit=3,
        seed=args.seed,
        report_to="none",
        optim="adamw_8bit",
        max_grad_norm=1.0,
        dataloader_num_workers=2,
        group_by_length=True,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        max_seq_length=args.max_seq_len,
        dataset_text_field="text",
        packing=True,  # Efficient packing of short sequences
        args=training_args,
    )

    # Resume from checkpoint if specified
    resume_from = args.resume if args.resume and Path(args.resume).exists() else None
    if resume_from:
        print(f"Resuming from checkpoint: {resume_from}")

    print("\n" + "=" * 60)
    print("Starting training")
    print(f"  Model: {args.model}")
    print(f"  Epochs: {args.epochs}")
    print(f"  Batch size: {args.batch_size} × {args.grad_accum} grad accum")
    print(f"  Effective batch size: {args.batch_size * args.grad_accum}")
    print(f"  Learning rate: {args.lr}")
    print(f"  Max sequence length: {args.max_seq_len}")
    print(f"  Output: {output_dir}")
    print("=" * 60 + "\n")

    trainer.train(resume_from_checkpoint=resume_from)

    # Save final model
    print("\nSaving final model...")
    final_dir = output_dir / "final"
    model.save_pretrained(str(final_dir))
    tokenizer.save_pretrained(str(final_dir))

    # Also save merged 16-bit model for inference
    print("Saving merged 16-bit model for inference...")
    merged_dir = output_dir / "merged-16bit"
    model.save_pretrained_merged(
        str(merged_dir),
        tokenizer,
        save_method="merged_16bit",
    )

    # Save as GGUF for local deployment
    print("Saving GGUF quantized model...")
    gguf_dir = output_dir / "gguf"
    try:
        model.save_pretrained_gguf(
            str(gguf_dir),
            tokenizer,
            quantization_method="q4_k_m",
        )
    except Exception as e:
        print(f"  GGUF export failed (non-critical): {e}")

    # Push to HuggingFace Hub
    if args.push_to_hub:
        print(f"Pushing to HuggingFace Hub: {args.push_to_hub}")
        model.push_to_hub_merged(
            args.push_to_hub,
            tokenizer,
            save_method="merged_16bit",
        )

    # Save training metadata
    meta = {
        "base_model": args.model,
        "lora_rank": args.lora_rank,
        "lora_alpha": args.lora_alpha,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "grad_accum": args.grad_accum,
        "learning_rate": args.lr,
        "max_seq_len": args.max_seq_len,
        "train_samples": len(train_dataset),
        "eval_samples": len(eval_dataset) if eval_dataset else 0,
        "snac_levels": {
            "level_0_offset": 10,
            "level_1_offset": 4106,
            "level_2_offset": 8202,
            "codes_per_level": 4096,
            "interleave_pattern": "[L0, L1, L2, L2, L1, L2, L2]",
            "tokens_per_frame": 7,
        },
    }
    with open(output_dir / "training_meta.json", 'w') as f:
        json.dump(meta, f, indent=2)

    print("\nTraining complete!")
    print(f"  Final LoRA: {final_dir}")
    print(f"  Merged 16-bit: {merged_dir}")
    print(f"  GGUF: {gguf_dir}")
    if args.push_to_hub:
        print(f"  Hub: https://huggingface.co/{args.push_to_hub}")


def main():
    args = get_training_args()

    # Verify unsloth is available
    try:
        import unsloth  # noqa: F401
        print(f"Unsloth version: {unsloth.__version__}")
    except ImportError:
        print("ERROR: Unsloth not installed.")
        print("Install with: pip install unsloth[colab-new]")
        print("Or: pip install unsloth datasets transformers trl peft accelerate bitsandbytes")
        return

    train(args)


if __name__ == '__main__':
    main()
