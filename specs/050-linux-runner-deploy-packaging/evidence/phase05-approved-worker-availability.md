Preflight rejects an installed approved adapter when its worker is unavailable. Blocked: independent review remains pending.

The regression kept the adapter installed and the credential probe successful. Its availability check returned false. Preflight incorrectly reported success before repair.

The preflight resolves the adapter through the dispatch registry. It checks the adapter's availability before running the separate credential probe. A bounded process contains the adapter check. The error names the approved backend and requires its worker installation.

Seven phase checks pass. Missing plugin and missing adapter cases remain covered. The regression log is `/tmp/gwrk-050-unavailable-backend-preflight-red.log`. The passing log is `/tmp/gwrk-050-unavailable-backend-preflight-green.log`.

The installed native Linux proof remains recorded separately. No live host or project was enrolled by this repair.
