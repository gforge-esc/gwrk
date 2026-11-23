# Harvest recipient repair

Preserve omitted recipient input through both durable harvest entry paths. The restored regression fails before repair. Blocked: implementation and independent clearance.

The current code changes undefined to null before calling runManualHarvest. Undefined must resolve the accepted dispatch recipient or enrolled project's default Slack recipient. Explicit null must suppress Slack delivery. Preserve both behaviors without changing durable operation identity or delivery receipts.

The restored review test passes 21 checks and fails one before repair. Evidence is `/tmp/gwrk-nov23-durable-recipient-red.log`. The original review patch and findings remain preserved. Repair both public entry paths in src/engine/harvest.ts. Keep coordinator and adapter work already completed.
