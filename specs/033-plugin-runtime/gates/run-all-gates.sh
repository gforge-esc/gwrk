#!/usr/bin/env bash
set -euo pipefail
pnpm vitest run src/plugins/ src/engine/registry.test.ts
