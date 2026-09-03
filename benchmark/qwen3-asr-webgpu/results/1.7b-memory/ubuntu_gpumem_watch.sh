#!/bin/bash
# Sample total GPU memory in use (nvidia-smi, MiB) every 0.5 s for <seconds> on a discrete GPU;
# write the series to ~/sokuji-webgpu-spike/gpumem_series.csv and print baseline / peak /
# steady (median of the last third of samples that are above baseline + 100 MiB).
# usage: ubuntu_gpumem_watch.sh <seconds>
S=${1:-120}
CSV=~/sokuji-webgpu-spike/gpumem_series.csv
echo "t_ms,used_mib" > "$CSV"
end=$(( $(date +%s) + S ))
while [ "$(date +%s)" -lt "$end" ]; do
  u=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1 | tr -d ' ')
  echo "$(date +%s%3N),$u" >> "$CSV"
  sleep 0.5
done
python3 - "$CSV" <<'EOF'
import csv, statistics, sys
v = [int(r["used_mib"]) for r in csv.DictReader(open(sys.argv[1]))]
base = min(v[:5]) if len(v) >= 5 else min(v)
loaded = [x for x in v if x > base + 100]
steady = statistics.median(loaded[len(loaded)*2//3:]) if len(loaded) >= 3 else float("nan")
print(f"{len(v)} samples; GPU memory used: baseline {base} MiB, peak {max(v)} MiB (+{max(v)-base}), steady {steady:.0f} MiB (+{steady-base:.0f})")
EOF
