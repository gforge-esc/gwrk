# Architecture readiness adapter preparation

The read-only readiness adapter implements the approved phase 2 discovery contract. CLI and discovery integration remain open. Independent review remains pending.

## Behavior

Selection, managed context health and assessment evidence remain separate. Ready context means matching managed target bytes and a readable decision index. It does not establish code conformance.

The adapter finds dated archive reports and custom evidence through tracked or non-ignored Git inventory. It rejects paths outside the project. Valid provenance timestamps determine ordering with archive dates as fallback. Equal timestamps use repository-relative path order. Structured scope uses the existing assessment validator.

## Verification

The initial suite failed while the adapter was absent. Ten behavior checks then passed. Three additional regressions exposed compatibility gaps. Empty reports hid earlier evidence. Optional provenance fields hid valid custom output. Default CLI timestamp directories were absent from the archive scan. Each case failed before repair.

All thirteen adapter checks and seventeen architecture checks now pass. Build and targeted Biome checks passed. Logs are /tmp/gwrk-045-readiness-red.log and /tmp/gwrk-045-readiness-regressions-red.log. The final result is /tmp/gwrk-045-readiness-final-green.log.

The checkout environment helper is reused from reviewed feature 046. This preparation does not complete phase 2 tasks for engine discovery or command output.
