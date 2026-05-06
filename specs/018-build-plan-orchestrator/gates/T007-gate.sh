#!/bin/bash
# T007: Implement src/cli.ts (wire plan command)
set -e
grep -q "import { planCommand } from \"./commands/plan.js\"" src/cli.ts
grep -q "program.addCommand(planCommand)" src/cli.ts
echo "T007: Plan command wired into CLI."