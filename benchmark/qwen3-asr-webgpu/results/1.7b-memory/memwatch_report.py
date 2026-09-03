#!/usr/bin/env python3
"""From a memwatch.sh sample file: per Chrome process type the first / peak / steady RSS (MB),
and the system-wide MemAvailable drop. "steady" = median over the last third of the samples in
which the harness GPU process was above its idle level (i.e. during the decode phase, after the
load peak). On a UMA box the MemAvailable drop is the only figure that includes GPU
allocations; process RSS does not see Vulkan device-local memory."""
import statistics
import sys
from collections import defaultdict

samples = defaultdict(list)
with open(sys.argv[1]) as f:
    for line in f:
        parts = line.split()
        if len(parts) != 3:
            continue
        t, typ, kb = float(parts[0]), parts[1], int(parts[2])
        samples[(t, typ)].append(kb // 1024)
per_type = defaultdict(list)
for (t, typ), v in samples.items():
    per_type[typ].append((t, sum(v)))
for typ in per_type:
    per_type[typ].sort()

gpu = per_type.get("gpu", [])
if gpu:
    idle = gpu[0][1]
    loaded_ts = [t for t, v in gpu if v > idle + 50]
else:
    idle, loaded_ts = 0, []
tail = loaded_ts[len(loaded_ts) * 2 // 3:] if loaded_ts else []
tailset = set(tail)

def steady(series):
    vals = [v for t, v in series if t in tailset]
    return statistics.median(vals) if vals else float("nan")

for typ, series in sorted(per_type.items()):
    vals = [v for _, v in series]
    if typ == "sys_avail":
        print(f"system MemAvailable: first={vals[0]} MB  min={min(vals)} MB  steady={steady(series):.0f} MB"
              f"  -> run cost: peak {vals[0] - min(vals)} MB, steady {vals[0] - steady(series):.0f} MB")
    else:
        print(f"{typ:9} first={vals[0]:6d} MB  peak={max(vals):6d} MB  steady={steady(series):6.0f} MB  last={vals[-1]:6d} MB  samples={len(vals)}")
print(f"(steady window: {len(tail)} samples while the GPU process was loaded)")
