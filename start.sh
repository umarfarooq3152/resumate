#!/usr/bin/env bash
# Start all services from the PROJECT ROOT.
# Usage:  ./start.sh          — starts both FastAPI and WhatsApp sidecar
#         ./start.sh api       — FastAPI only
#         ./start.sh whatsapp  — WhatsApp sidecar only

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

start_api() {
  echo "Starting FastAPI backend on :8000..."
  "$ROOT/.venv/bin/uvicorn" src.api.main:app --reload --port 8000
}

start_whatsapp() {
  echo "Starting WhatsApp sidecar on :3001..."
  cd "$ROOT/whatsapp-service"
  node index.js
}

case "${1:-both}" in
  api)       start_api ;;
  whatsapp)  start_whatsapp ;;
  both)
    # Run both in parallel; Ctrl-C kills both
    start_api &
    API_PID=$!
    start_whatsapp &
    WA_PID=$!
    trap "kill $API_PID $WA_PID 2>/dev/null" EXIT INT TERM
    wait
    ;;
  *)
    echo "Usage: $0 [api|whatsapp|both]"
    exit 1
    ;;
esac
