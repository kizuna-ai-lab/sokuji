#!/usr/bin/env python3
"""Paired per-clip comparison of two spike-page logs (e.g. 0.6B vs 1.7B on one box).
usage: pair_compare.py <log A> <log B> [label A] [label B]"""
import json
import statistics
import sys

sys.path.insert(0, "/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/qwen3-asr-1.7b/benchmark/qwen3-asr-webgpu")
_argv, sys.argv = sys.argv, sys.argv[:1]  # summarize.py runs its CLI at import time
import summarize  # noqa: E402  (its browser_rows() attaches CER against results/manifest.json)
sys.argv = _argv

def load(path):
    rows = {}
    _env, load_line, rlist = summarize.browser_rows(path)
    for r in rlist:
        if "clip" in r and "cold" not in r["clip"] and r.get("msPerToken") is not None:
            rows[r["clip"]] = r
    return rows, load_line

a, b = sys.argv[1], sys.argv[2]
la = sys.argv[3] if len(sys.argv) > 3 else "A"
lb = sys.argv[4] if len(sys.argv) > 4 else "B"
ra, loada = load(a)
rb, loadb = load(b)
clips = [c for c in ra if c in rb]
print(f"{'clip':22} {'ms/tok '+la:>12} {'ms/tok '+lb:>12} {'ratio':>6} | {'prefill '+la:>10} {'prefill '+lb:>10} | {'enc '+la:>7} {'enc '+lb:>7} | {'CER '+la:>7} {'CER '+lb:>7}")
ratios, cer_a, cer_b, pa, pb, ea, eb = [], [], [], [], [], [], []
for c in clips:
    x, y = ra[c], rb[c]
    ratios.append(y["msPerToken"] / x["msPerToken"])
    cer_a.append(x.get("cer") or 0); cer_b.append(y.get("cer") or 0)
    pa.append(x["prefillMs"]); pb.append(y["prefillMs"]); ea.append(x["encoderMs"]); eb.append(y["encoderMs"])
    print(f"{c:22} {x['msPerToken']:12.1f} {y['msPerToken']:12.1f} {ratios[-1]:6.2f} | {x['prefillMs']:10.0f} {y['prefillMs']:10.0f} | {x['encoderMs']:7.0f} {y['encoderMs']:7.0f} | {cer_a[-1]:7.3f} {cer_b[-1]:7.3f}")
print(f"\nmedian ms/token: {la} {statistics.median(r['msPerToken'] for r in ra.values()):.1f}  {lb} {statistics.median(r['msPerToken'] for r in rb.values()):.1f}  (median per-clip ratio {statistics.median(ratios):.2f})")
print(f"median prefill:  {la} {statistics.median(pa):.0f} ms  {lb} {statistics.median(pb):.0f} ms;  median encoder: {la} {statistics.median(ea):.0f} ms  {lb} {statistics.median(eb):.0f} ms")
print(f"median RTF:      {la} {statistics.median(r['rtf'] for r in ra.values()):.3f}  {lb} {statistics.median(r['rtf'] for r in rb.values()):.3f}")
print(f"mean CER:        {la} {statistics.mean(cer_a):.3f}  {lb} {statistics.mean(cer_b):.3f}   (ja clips: {la} {statistics.mean(v for c, v in zip(clips, cer_a) if c.startswith('ja')):.3f}  {lb} {statistics.mean(v for c, v in zip(clips, cer_b) if c.startswith('ja')):.3f})")
if loada and loadb:
    print(f"load total:      {la} {loada['totalMs']} ms  {lb} {loadb['totalMs']} ms  (encoder {loada['encoderMs']}/{loadb['encoderMs']}, init {loada['initMs']}/{loadb['initMs']}, step {loada['stepMs']}/{loadb['stepMs']})")
