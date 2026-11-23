# Final ingress review repair

The latest implementation is preserved. Two blocking findings reproduce in three tests. Blocked: completion delivery can outlive shutdown, and acknowledged Slack replays leave accepted work held.

## Preserved state

The parent fast-forwarded from `113f6d66` to evidence head `a8fc9521`. This retains implementations `459a5aaa` and `87358a73` with their review history. Merge `e354d782` adds CI-only integration `4cb8dea3`. The merge used explicit author and committer identity and passed normal hooks.

The latest code review produced NO-GO commit `c84817bb`. Its source log is `2026-11-23T21-41-36_review-code-cli_049-durable-dispatch-harvest.log`. Queue task T026 and Slack action task T030 remain open. The other six phase-five tasks remain completed. No production repair or new ship run occurred during preparation.

## Findings

| Task | Trigger | Observed defect |
|---|---|---|
| T026, queue shutdown | Close starts before worker completion creates its delivery | Close resolves while the notifier is sending |
| T030, action replay | First acknowledgment fails after durable acceptance | Successful replay leaves the original operation accepted |

For queue shutdown, `src/server/dispatch.ts` snapshots `inFlight` through `Promise.all` in `close()`. The running worker later persists its completion notice and adds a flush promise. That promise was absent from the snapshot. The server may release ledger ownership while delivery remains active.

The repair must retain the persisted completion item. It can await resulting delivery work or leave a recoverable pending item without starting delivery during shutdown. Preserve cancellation and scheduled-close behavior. The restored test observes `true` for sending when close resolves. Its added persistence assertion prevents dropping the notice to satisfy shutdown.

For action replay, `src/server/slack-actions.ts` completes the action receipt before awaiting acknowledgment. `DispatchQueue.accept` holds the accepted operation until its release callback runs. An acknowledgment failure prevents that callback. Replay encounters the completed action receipt and returns through the denied branch. It never releases the original hold.

Both `retry_phase` and `request_changes` retain the same operation ID with status `accepted` and zero attempts. A successful acknowledgment of the exact authorized replay must release that operation once. Keep unrelated and unauthorized events from releasing it. The strengthened cases verify that an unauthorized replay leaves the operation held.

## Retained tests

The final review supplied `review-regressions-phase-05-87358a73-replay-close.patch`. It applied and passed its reverse check before test strengthening. Its SHA-256 is `9ae47871a3430a83088a7634d9ad133dcbbc60b1a1a8a89ce59d9a77d452ecb2`. The private archive remains unchanged.

- `src/server/dispatch.test.ts`: waits for outstanding worker completion delivery before close resolves. Also verifies the durable notice remains persisted.
- `src/server/durable-ingress.test.ts`: successful replay releases the original operation for each action. An unauthorized replay cannot release held work.

Both files already appear in the shared `gates/phase-05.sh` inventory and test command. No new test path or gate edit was needed. The earlier acceptance-ordering and drain-scheduling assertions remain active.

## Verification

| Check | Observed result | Target |
|---|---|---|
| Exact restored review patch | Reproduced, 3 failures; 36 passed | Observe both findings before repair |
| Shared phase-five test selection | Reproduced, 3 failures; 224 passed | Only the retained review failures |
| Build | Pass | Zero type errors |
| Lint | Pass | Zero findings |

Logs remain in `.runs/ingress-final-review-nov23/`. `restored-review-red.log` records the exact restored patch. `phase5-red.log` records all nine gate suites. It includes the strengthened cases. `final-code-review.log` preserves the source review. The folder also contains the original patch plus build and lint logs.

## Repair boundary

Keep scheduling and shutdown ownership in the server adapter. Preserve durable acceptance and action authorization through the existing application ports. Keep the original operation identity and receipt association. Preserve project scope and validated Slack destinations.

Retain completed application fixes and all earlier regression tests. Do not reopen completed foundation phases. Require the shared phase gate to pass after repair. The test fixtures use temporary repositories and SQLite stores with synthetic workers and notifiers. Preparation performed no live delivery, deployment or daemon operation.
