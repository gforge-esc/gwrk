#!/bin/bash
set -euo pipefail
# Gate: T009 — Agent dispatch abstraction in src/utils/agent.ts

test -f src/utils/agent.ts
grep -q 'dispatchAgent' src/utils/agent.ts
grep -q 'AgentBackend' src/utils/agent.ts
grep -q 'gemini' src/utils/agent.ts
grep -q 'claude' src/utils/agent.ts
grep -q 'codex' src/utils/agent.ts
grep -q 'execCommand' src/utils/agent.ts
grep -q 'ExecResult' src/utils/agent.ts

echo "PASS: T009 — agent.ts has dispatchAgent with all backends"
