#!/bin/bash
set -e
test -f src/utils/gate-gen.ts
grep -q 'export const generateGate' src/utils/gate-gen.ts
