#!/usr/bin/env bash
# Backend quality gate: lint, format check, strict typing, and tests.
# Usage (Git Bash): bash scripts/check.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PY=".venv/Scripts/python.exe"
if [ ! -x "$PY" ]; then
  PY=".venv/bin/python"
fi
if [ ! -x "$PY" ]; then
  echo "[error] No virtualenv found. Run: python -m venv .venv && pip install -e '.[dev]'" >&2
  exit 1
fi

run() {
  echo ">>> $1"
  shift
  "$@"
}

run "ruff check"          "$PY" -m ruff check .
run "ruff format --check" "$PY" -m ruff format --check .
run "mypy"                "$PY" -m mypy app
run "pytest"              "$PY" -m pytest -q

echo
echo "All backend checks passed."
