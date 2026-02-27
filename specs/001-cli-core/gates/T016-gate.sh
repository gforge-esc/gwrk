#!/bin/bash
set -euo pipefail
# Gate: T016 — Gate script generator in src/utils/gate-gen.ts

test -f src/utils/gate-gen.ts
grep -q 'generateGates' src/utils/gate-gen.ts
grep -q 'chmod\|0o755\|executable' src/utils/gate-gen.ts
grep -q 'writeFileSync\|writeFile' src/utils/gate-gen.ts
grep -q '#!/bin/bash\|shebang\|set -euo' src/utils/gate-gen.ts

echo "PASS: T016 — gate-gen.ts generates executable shell scripts"
