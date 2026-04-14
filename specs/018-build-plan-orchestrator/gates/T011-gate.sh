#!/bin/bash
set -euo pipefail
# Gate: T011 — Implement package.json (graphology)

grep -q "graphology" package.json

echo "PASS: T011 — graphology dependency added"
