# Contract: Harvest Engine

**Path**: `specs/011-harvest/contracts/harvest.md`
**Type**: Method-Level Contract

This contract defines the core logic for the Harvest engine in `src/engine/harvest.ts`.

---

## `harvestFeature(payload: HarvestPayload): Promise<HarvestResult>`

**Orchestrates the post-merge lifecycle for a feature.**

### Input
```typescript
interface HarvestPayload {
  featureId: string;
  phaseId?: string;
  prNumber: number;
  mergeCommitSha: string;
  mergedAt: string; // ISO timestamp
}
```

### Steps
1. **Idempotency Check (FR-H10)**: Query `compression` table for existing `feature_id + phase_id`. If record exists with matching `merge_commit_sha`, log skip and return early.
2. **Finalize DB Records**: Update `runs` table with `status: 'merged'`, `finished_at: mergedAt`, `pr_number`, and `merge_commit_sha`.
3. **Log Finalization**: Move logs from `.runs/` to `specs/<featureId>/.gwrk/runs/`. Update `index.json`.
4. **Git Commit**: Add and commit the new logs and index.
5. **Calculate Compression**: Call `compression.computeCompression()` using Git actuals and Effort forecast.
6. **Record Compression**: Insert record into `compression` table.
7. **Notify Slack (FR-H07, FR-H11)**: Post "🏆 Done, Done!" message via `notifyDoneDone()`. This is the **sole notification point** — the webhook handler in `github.ts` MUST NOT duplicate this call.
8. **Cleanup**: Delete the phase branch from remote.

---

## `finalizeLogs(featureId: string, phaseId?: string): Promise<void>`

**Moves raw logs to permanent home and indexes them.**

### Requirements
- Source: `.runs/<featureId>_p<phaseId>_*.log` (or equivalent)
- Destination: `specs/<featureId>/.gwrk/runs/`
- Index: `specs/<featureId>/.gwrk/runs/index.json` (maps filename to runId, phase, timestamp, size)

---

## `notifyDoneDone(report: CompressionReport): Promise<void>`

**Posts the "🏆 Done, Done!" notification to Slack.**

### Requirements
- Message includes: Feature name, Phase, Point Compression, Total Compression, Active Coding Time, Delivery Window.
- Use `POST /api/notify` internally.

---

## `cleanupBranch(branchName: string): Promise<void>`

**Deletes the merged branch from origin.**

### Requirements
- Command: `git push origin --delete <branchName>`
- Should log failure but not crash the harvest pipeline.
