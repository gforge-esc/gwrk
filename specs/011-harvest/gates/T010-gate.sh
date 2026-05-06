#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Verify githubWebhookPlugin registration
grep -q "githubWebhookPlugin" src/server/index.ts

echo "PASS: T010 — Implement src/server/index.ts (MODIFY: register githubWebhookPlugin)"
