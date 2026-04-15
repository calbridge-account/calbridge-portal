#!/bin/bash
# Nightly dbt run for Calbridge mart pre-aggregations
# Run at 02:00 UTC daily (after data ingestion completes)
# Logs to /var/log/calbridge-dbt.log

set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DBT_DIR="$WORKSPACE_DIR/calbridge_dbt"
LOG_FILE="/home/azureuser/.openclaw/workspace/logs/dbt.log"

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting dbt run..." | tee -a "$LOG_FILE"

# Load env vars (skip comments and blank lines)
set -a
# shellcheck disable=SC1091
source "$WORKSPACE_DIR/.env"
set +a

cd "$DBT_DIR"

# Run marts only (staging are views — no cost, no need to rebuild nightly)
dbt run --models marts 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] dbt run completed successfully." | tee -a "$LOG_FILE"
else
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] dbt run FAILED with exit code $EXIT_CODE." | tee -a "$LOG_FILE"
fi

exit "$EXIT_CODE"
