#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T020 — Modify ADR-009-domain-ontology-information-hierarchy-ux.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-009-domain-ontology-information-hierarchy-ux.md || { echo "FAIL: T020 — file not found: docs/decisions/ADR-009-domain-ontology-information-hierarchy-ux.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-009-domain-ontology-information-hierarchy-ux.md --reporter=verbose \
  || { echo "FAIL: T020 — vitest failed for docs/decisions/ADR-009-domain-ontology-information-hierarchy-ux.md" >&2; exit 1; }

echo "PASS: T020 — Modify ADR-009-domain-ontology-information-hierarchy-ux.md"
