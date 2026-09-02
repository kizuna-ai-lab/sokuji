#!/bin/bash
# Sample every 0.5 s while a harness run is in flight: the RSS of every headless_shell / chrome
# process by type, plus the system-wide MemAvailable (kB). On the GB10 (unified memory,
# nvidia-smi reports N/A, Vulkan device-local buffers are not mapped into the process) the
# drop in MemAvailable is the only number that includes the GPU allocations.
# usage: memwatch.sh <outfile> &  ... run the page ...  kill %1 ; then: memwatch_report.py <outfile>
OUT="$1"
: > "$OUT"
while true; do
  t=$(date +%s.%N)
  ps -eo rss,args 2>/dev/null | grep -E 'headless_shell|chrome' | grep -v grep | awk -v t="$t" '{
    type="browser"; if ($0 ~ /--type=gpu-process/) type="gpu"; else if ($0 ~ /--type=renderer/) type="renderer"; else if ($0 ~ /--type=utility/) type="utility"; else if ($0 ~ /--type=zygote/) type="zygote";
    print t, type, $1 }' >> "$OUT"
  awk -v t="$t" '/^MemAvailable:/ {print t, "sys_avail", $2}' /proc/meminfo >> "$OUT"
  sleep 0.5
done
