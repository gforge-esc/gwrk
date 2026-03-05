#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement biome.json
# Asserts: Derived from task description

test -f biome.json

echo "PASS: T003 — Implement biome.json"
