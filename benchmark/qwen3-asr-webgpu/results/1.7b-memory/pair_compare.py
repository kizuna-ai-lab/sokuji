#!/usr/bin/env python3
"""Paired per-clip comparison of two spike-page logs (e.g. 0.6B vs 1.7B on one box).

usage: pair_compare.py <log A> <log B> [label A] [label B] [--allow-partial]

Both logs must cover the same clips; otherwise the per-log medians and the per-clip ratios
would be computed over different sets. A clip missing from one side (an error row, a run that
died early) aborts with the names unless --allow-partial is given, in which case every figure
is computed over the intersection only and that is stated in the output.
"""
import statistics
import sys
from pathlib import Path

# summarize.py lives two levels up (benchmark/qwen3-asr-webgpu/); it runs its CLI at import
# time, so hide our arguments while importing it.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
_argv, sys.argv = sys.argv, sys.argv[:1]
import summarize  # noqa: E402  (browser_rows() attaches CER against results/manifest.json)
sys.argv = _argv

allow_partial = "--allow-partial" in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith("--")]
if len(args) < 2:
    raise SystemExit(__doc__)


def load(path):
    rows = {}
    _env, load_line, rlist = summarize.browser_rows(path)
    for r in rlist:
        if "clip" in r and "cold" not in r["clip"] and r.get("msPerToken") is not None:
            rows[r["clip"]] = r
    return rows, load_line


a, b = args[0], args[1]
la = args[2] if len(args) > 2 else "A"
lb = args[3] if len(args) > 3 else "B"
ra, loada = load(a)
rb, loadb = load(b)
only_a = sorted(set(ra) - set(rb))
only_b = sorted(set(rb) - set(ra))
if only_a or only_b:
    msg = f"clip sets differ: only in {la}: {only_a or '-'}; only in {lb}: {only_b or '-'}"
    if not allow_partial:
        raise SystemExit(msg + " (pass --allow-partial to compare the intersection)")
    print("WARNING " + msg + " — every figure below is over the intersection only")
clips = [c for c in ra if c in rb]
if not clips:
    raise SystemExit("no clip present in both logs")
ra = {c: ra[c] for c in clips}
rb = {c: rb[c] for c in clips}
print(f"{'clip':22} {'ms/tok '+la:>12} {'ms/tok '+lb:>12} {'ratio':>6} | {'prefill '+la:>10} {'prefill '+lb:>10} | {'enc '+la:>7} {'enc '+lb:>7} | {'CER '+la:>7} {'CER '+lb:>7}")
ratios, cer_a, cer_b, pa, pb, ea, eb = [], [], [], [], [], [], []
for c in clips:
    x, y = ra[c], rb[c]
    ratios.append(y["msPerToken"] / x["msPerToken"])
    cer_a.append(x.get("cer") or 0); cer_b.append(y.get("cer") or 0)
    pa.append(x["prefillMs"]); pb.append(y["prefillMs"]); ea.append(x["encoderMs"]); eb.append(y["encoderMs"])
    print(f"{c:22} {x['msPerToken']:12.1f} {y['msPerToken']:12.1f} {ratios[-1]:6.2f} | {x['prefillMs']:10.0f} {y['prefillMs']:10.0f} | {x['encoderMs']:7.0f} {y['encoderMs']:7.0f} | {cer_a[-1]:7.3f} {cer_b[-1]:7.3f}")
print(f"\n{len(clips)} clips paired")
print(f"median ms/token: {la} {statistics.median(r['msPerToken'] for r in ra.values()):.1f}  {lb} {statistics.median(r['msPerToken'] for r in rb.values()):.1f}  (median per-clip ratio {statistics.median(ratios):.2f})")
print(f"median prefill:  {la} {statistics.median(pa):.0f} ms  {lb} {statistics.median(pb):.0f} ms;  median encoder: {la} {statistics.median(ea):.0f} ms  {lb} {statistics.median(eb):.0f} ms")
print(f"median RTF:      {la} {statistics.median(r['rtf'] for r in ra.values()):.3f}  {lb} {statistics.median(r['rtf'] for r in rb.values()):.3f}")
ja = [i for i, c in enumerate(clips) if c.startswith("ja")]
ja_line = f"   (ja clips: {la} {statistics.mean(cer_a[i] for i in ja):.3f}  {lb} {statistics.mean(cer_b[i] for i in ja):.3f})" if ja else ""
print(f"mean CER:        {la} {statistics.mean(cer_a):.3f}  {lb} {statistics.mean(cer_b):.3f}{ja_line}")
if loada and loadb:
    print(f"load total:      {la} {loada['totalMs']} ms  {lb} {loadb['totalMs']} ms  (encoder {loada['encoderMs']}/{loadb['encoderMs']}, init {loada['initMs']}/{loadb['initMs']}, step {loada['stepMs']}/{loadb['stepMs']})")
