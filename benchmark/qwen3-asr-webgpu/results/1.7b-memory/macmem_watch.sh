#!/bin/bash
# Sample Chrome GPU-process memory on macOS every ~0.5 s for <seconds>, using phys_footprint
# (`footprint -p`, the Activity Monitor "Memory" figure, which attributes IOAccelerator /
# Metal allocations to the process — plain RSS does not). Only GPU processes whose browser
# was launched with --remote-debugging-port (i.e. by run_page.py) are counted, so the user's
# own Chrome cannot contaminate the numbers. Records a series to
# ~/sokuji-webgpu-spike/macmem_series.csv (epoch-ms, harness GPU-process footprint MB, per-pid
# detail) and prints the peak. usage: macmem_watch.sh <seconds>
S=${1:-120}
CSV=~/sokuji-webgpu-spike/macmem_series.csv
echo "t_ms,harness_mb,detail" > "$CSV"
peak=0; n=0
end=$(( $(date +%s) + S ))
while [ "$(date +%s)" -lt "$end" ]; do
  total=0; detail=""
  while read -r pid ppid _rest; do
    [ -z "$pid" ] && continue
    ps -o command= -p "$ppid" 2>/dev/null | grep -q -- '--remote-debugging-port' || continue
    mb=$(footprint -p "$pid" 2>/dev/null | awk '/Footprint:/ { for (i=1;i<=NF;i++) if ($i=="Footprint:") { v=$(i+1); u=$(i+2); if (u=="GB") v=v*1024; else if (u=="KB") v=v/1024; print int(v); exit } }')
    mb=${mb:-0}
    total=$((total + mb)); detail="$detail$pid=$mb;"
  done <<< "$(ps -axo pid,ppid,command | grep 'Google Chrome' | grep -- '--type=gpu-process' | grep -v grep | awk '{print $1, $2}')"
  t=$(python3 -c 'import time; print(int(time.time()*1000))')
  echo "$t,$total,$detail" >> "$CSV"
  [ "$total" -gt "$peak" ] && peak=$total
  n=$((n+1))
  sleep 0.5
done
echo "$n samples; peak harness Chrome GPU-process footprint $peak MB"
