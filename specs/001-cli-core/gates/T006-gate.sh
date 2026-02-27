#!/bin/bash
set -e
test -f src/utils/parser.ts
grep -q 'export const parsePlan' src/utils/parser.ts
