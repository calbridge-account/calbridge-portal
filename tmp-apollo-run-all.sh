#!/bin/bash
cd /home/azureuser/.openclaw/workspace
for i in $(seq 1 20); do
  echo "--- Starting batch $i at $(date -u '+%H:%M:%S UTC') ---"
  node tmp-apollo-send.js $i
  if [ $i -lt 20 ]; then
    echo "Waiting 5 minutes before batch $((i+1))..."
    sleep 300
  fi
done
echo "=== All 20 batches complete at $(date -u) ==="
rm tmp-apollo-send.js tmp-apollo-run-all.sh gtm/already-sent.json 2>/dev/null
echo "Cleaned up."
