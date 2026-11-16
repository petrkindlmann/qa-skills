#!/bin/sh
# Logs kernel network-buffer use every 15 s. Past LIMIT mbufs in use it records who holds sockets
# and stops the trial, so buffer exhaustion is seen in a log instead of in a panic.
R="$(cd "$(dirname "$0")/.." && pwd)"
LIMIT=${LIMIT:-15000}
LOG="$R/out/netwatch.log"
n=0
while [ $n -lt 230 ]; do
  n=$((n + 1))
  m=$(netstat -m)
  kb=$(printf '%s\n' "$m" | awk '/KB allocated to network/ {print $1}')
  mb=$(printf '%s\n' "$m" | awk 'NR==1 {print $1}')
  used=${mb%%/*}
  echo "$(date +%H:%M:%S) net_kb=$kb mbufs=$mb sockets=$(sysctl -n kern.ipc.numopensockets 2>/dev/null) files=$(sysctl -n kern.num_files) load=$(sysctl -n vm.loadavg | awk '{print $2}') trial=$(wc -l < "$R/out/trial.jsonl" | tr -d ' ') $(tail -1 "$R/out/trial.log" | cut -c1-28)" >> "$LOG"
  if [ "${used:-0}" -gt "$LIMIT" ]; then
    { echo "LIMIT PASSED"; printf '%s\n' "$m"; lsof -nP -i 2>/dev/null | awk 'NR>1 {print $1, $2}' | sort | uniq -c | sort -rn | head -25; } >> "$LOG"
    d=$(pgrep -f 'node bin/trial.mjs' | head -1)
    [ -n "$d" ] && { pkill -P "$d"; kill "$d"; echo "stopped trial $d" >> "$LOG"; }
    exit 3
  fi
  pgrep -f 'node bin/trial.mjs' > /dev/null || { echo "trial not running, watcher ends" >> "$LOG"; exit 0; }
  sleep 15
done
