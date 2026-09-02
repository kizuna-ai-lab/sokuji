#!/usr/bin/env python3
"""Peak and steady-state from a fleet memory series CSV (t_ms, largest_mb, sum_mb).
Steady state = median of the largest-process column over the last third of the samples in
which Chrome was alive (value > idle floor)."""
import csv
import statistics
import sys

rows = [r for r in csv.DictReader(open(sys.argv[1])) if r.get("t_ms")]
col = "harness_mb" if rows and "harness_mb" in rows[0] else "largest_mb"
vals = [float(r[col]) for r in rows]
if not vals:
    print("no samples"); sys.exit(0)
idle = min(vals)
alive = [v for v in vals if v > idle + 50]
peak = max(vals)
steady = statistics.median(alive[len(alive) * 2 // 3:]) if len(alive) >= 3 else float("nan")
print(f"samples={len(vals)} idle(min)={idle:.0f} MB  peak={peak:.0f} MB  steady(last third while loaded)={steady:.0f} MB  -> model cost: peak {peak - idle:.0f} MB, steady {steady - idle:.0f} MB")
