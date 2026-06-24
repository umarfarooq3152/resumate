#!/usr/bin/env bash
# Run the full stack locally for demo/development.
# Usage: ./start.sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "[1/2] Starting backend on http://localhost:8080 ..."
cd "$ROOT"
uvicorn src.api.main:app --host 0.0.0.0 --port 8080 --reload &
BACKEND_PID=$!

echo "[2/2] Starting frontend on http://localhost:3000 ..."
cd "$ROOT/frontend"
npm run dev -- --port 3000 &
FRONTEND_PID=$!

echo ""
echo "  Backend  → http://localhost:8080"
echo "  Frontend → http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
