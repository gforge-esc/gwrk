#!/bin/bash
set -euo pipefail
# AUTHORED
test -f Dockerfile.sandbox || { echo "FAIL: T035 — file not found: Dockerfile.sandbox" >&2; exit 1; }
grep -q 'FROM node:20-bookworm-slim' Dockerfile.sandbox || { echo "FAIL: T035 — Dockerfile.sandbox missing base image" >&2; exit 1; }
echo "PASS: T035 — Implement Dockerfile.sandbox"
