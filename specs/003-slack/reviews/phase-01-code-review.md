# Code Review: 003 Slack — Phase 1 (Bless the Ship)

**Status**: ❌ Fails (Incomplete / Architectural Divergence)
**Date**: 2026-05-05
**Reviewer**: Gemini CLI (Autonomous Agent)

## Summary

The implementation of Phase 1 ("Bless the Ship — Merge from Slack") is currently incomplete and diverges from the specified architectural direction in `plan.md`. While basic handler registration exists, the core logic for merging PRs and retrying phases uses internal placeholders or local git operations instead of the required GitHub CLI (`gh`) and external command spawning.

## Critical Findings

### 1. `src/server/slack-actions.ts`: Incorrect Merge Logic
- **Issue**: The `merge_pr` handler calls `context.git.mergePhaseBack(featureId, phaseId)`.
- **Finding**: `GitManager.mergePhaseBack` performs a local `git checkout` and `git merge` in the server's working directory.
- **Violation**: The plan explicitly requires wiring this to "real `gh pr merge` via `execSync`". Local merges in the server directory do not satisfy the PR-based workflow and are potentially dangerous in a multi-user/multi-branch environment.
- **Impact**: PRs remain open on GitHub; the pipeline "advancement" is only local to the server's workspace.

### 2. `src/server/slack-messages.ts`: Missing PR Number in Payload
- **Issue**: The `reviewReady` button payload (`value`) only contains `featureId` and `phaseId`.
- **Finding**: `const value = JSON.stringify({ featureId: dispatch.featureId, phaseId: dispatch.phaseId });`
- **Violation**: The plan requires: "Ensure `reviewReady` message includes PR number in button value payload for lookup."
- **Impact**: The merge handler cannot easily identify the specific PR to merge via `gh` without performing additional lookups in the `runs` database, increasing complexity and risk of mismatch.

### 3. `src/server/slack-actions.ts`: Divergent Retry Mechanism
- **Issue**: The `retry_phase` handler calls `context.queue.enqueue`.
- **Finding**: While this re-runs the phase internally, it bypasses the CLI.
- **Violation**: The plan specifies: "Wire `retry_phase` handler to spawn `gwrk ship <feature> <phase>` as background process."
- **Impact**: Inconsistency between how ships are started from CLI vs. Slack. Spawning the CLI process ensures that environment variables, hooks, and local configurations are correctly applied.

### 4. `src/server/slack-actions.test.ts`: Outdated Test Assertions
- **Issue**: Tests are asserting the *incorrect* behavior.
- **Finding**: `expect(mockContext.git.mergePhaseBack).toHaveBeenCalledWith(...)`
- **Violation**: Tests (TR-003-001) should verify that `execSync` is called with the correct `gh pr merge` command.
- **Impact**: The test suite provides a false sense of security for an incorrect implementation.

### 5. `src/server/slack-actions.ts`: Reaction Handler Issues
- **Issue**: The `reaction_added` event handler also relies on `mergePhaseBack`.
- **Finding**: It attempts to parse the payload from message blocks but then calls the local merge method.
- **Impact**: Inherits all risks and failures of the `merge_pr` button handler.

## Recommendations

1. **Update `MessageBuilder.reviewReady`**:
   ```typescript
   const value = JSON.stringify({
     featureId: dispatch.featureId,
     phaseId: dispatch.phaseId,
     prNumber: dispatch.prNumber, // Add this
   });
   ```

2. **Refactor `merge_pr` handler**:
   - Change to use `execSync(`gh pr merge ${prNumber} --merge --auto -d`)`.
   - Ensure the command runs in the `projectRoot`.

3. **Refactor `retry_phase` handler**:
   - Change to use `execSync(`gwrk ship ${featureId} --phase ${phaseId} &`, { detached: true })` or similar background spawning.

4. **Update `GitManager`**:
   - Add a `mergePR(prNumber: number)` method that wraps the `gh` call to keep `slack-actions.ts` clean.

5. **Fix Tests**:
   - Update `slack-actions.test.ts` to mock `execSync` and verify the expected CLI commands.
