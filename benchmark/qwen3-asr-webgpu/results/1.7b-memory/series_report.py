#!/usr/bin/env python3
"""Peak and steady-state from a fleet memory series CSV (t_ms + one value column: harness_mb /
largest_mb / used_mib). Steady state = median over the last third of the samples that lie on
the loaded plateau (above 50 % of the peak), which excludes both the load ramp and the samples
after the harness Chrome has exited."""
import csv
import statistics
import sys

with open(sys.argv[1], newline="") as f:
    rows = [r for r in csv.DictReader(f) if r.get("t_ms")]
if not rows:
    print("no samples"); sys.exit(0)
col = next((c for c in ("harness_mb", "largest_mb", "used_mib") if c in rows[0]), None)
if col is None:
    raise SystemExit(f"no supported value column in {sys.argv[1]} (expected one of harness_mb, largest_mb, used_mib; got {list(rows[0])})")
vals = [float(r[col]) for r in rows]
peak = max(vals)
idle = min(vals)
plateau = [v for v in vals if v > peak * 0.5]
steady = statistics.median(plateau[len(plateau) * 2 // 3:]) if len(plateau) >= 3 else float("nan")
print(f"samples={len(vals)} idle(min)={idle:.0f}  peak={peak:.0f}  steady(plateau, last third)={steady:.0f}  [{col}]"
      f"  -> above idle: peak +{peak - idle:.0f}, steady +{steady - idle:.0f}; plateau samples={len(plateau)}")
