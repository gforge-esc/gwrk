# Workflow governance interfaces

Discovery gains additive readiness data. Dispatch keeps the existing transport and consumes a verified policy when the project supplies pins. Blocked: implementation awaits architecture-aware policy selection (feature 044).

## Workflow guidance

**Phase 1.** Keep the signatures for `WorkflowRuntime.executeWorkflow(name, input, options)` and `dispatchToAgent(task)` from [feature 043](../../043-unified-routing-prompt-delivery/contracts/routing-and-dispatch.md#workflow-runtime-and-prompt-payload-transport). Exercise both methods in the captured dispatch test.

- Specification and plan workflows use the selected layout and applicable enforcement rules. If the profile has no design, infer locations from the host repository and its recorded decisions.
- The Principal Engineer persona uses project verification commands and schema standards. Keep its review authority and reporting requirements.
- Every stage receives the complete readable `<architecture_decisions>` payload. Preserve all statuses and the existing behavior for a missing or unreadable index.
- When the target and index are readable, add one shared instruction outside the index payload. Follow Decided constraints and record conflicts with a Proposed target in the plan.

## Discovery

**Phase 2.** Extend [feature 013's discovery interface](../../013-agent-native-interface/contracts/discover.md) in place. Keep the current `ProjectDiscovery` fields and add the optional `architecture` field. See the [readiness data model](../data-model.md#architecture-readiness).

```typescript
async function readArchitectureReadiness(
  projectRoot: string,
  design?: ProjectDesign,
): Promise<ArchitectureReadiness | undefined>;

async function discoverProject(
  projectRoot: string,
): Promise<ProjectDiscovery>;
```

`readArchitectureReadiness` returns `undefined` when there is no selection, architecture context or assessment evidence. Otherwise it returns the selected design when present and independent context and assessment states. The adapter reads repository files. It verifies the managed target against the version 1 context manifest and checks the decision index for readability.

Look for `report.md` under dated children of `docs/architecture/assessments/`. Include custom output by listing tracked or non-ignored `assessment.json` paths with Git. A custom directory qualifies when it also contains a readable report and valid provenance timestamp. Deduplicate directories. Reject candidates that resolve outside the project.

Use a valid provenance timestamp first and the archive directory date as fallback. Order by timestamp descending then path ascending. Use the latest readable report. Prefer structured scope from the [existing assessment schema](../../039-architecture-context/contracts/context.md). A dated Markdown-only archive report still supplies a link. Missing or unusable provenance or scope returns unknown metadata.

`discoverProject` passes the existing profile design to the adapter and adds its result. Command `gwrk project discover` stays a query. Text output names context issues and links the latest report. JSON output exposes the same facts as structured fields. Missing or incomplete evidence keeps discovery successful and names the relevant check. Suggest `gwrk init` for missing managed context and `gwrk assess` for missing evidence. Keep `--format json` independent of `--agent` and emit `[exit:N | Xs]` on stderr.

## Policy versions

**Phase 3.** Add a read-only project lock to [feature 044's policy runtime](../../044-architecture-aware-policy/contracts/policy-selection.md#runtime-resolution-and-pack-compatibility).

```typescript
async function readProjectPolicyLock(
  projectRoot: string,
): Promise<ProjectPolicyLock | undefined>;

async function resolveEffectivePolicy(
  projectRoot: string,
  options?: ResolvePolicyOptions,
): Promise<EffectivePolicy>;
```

`readProjectPolicyLock` reads `.gwrk/policy-lock.json`. Absence opts into legacy resolution. Invalid JSON, duplicate names or unsupported format fail with the file path and a corrective message.

`resolveEffectivePolicy` keeps the existing method signature. With a lock present, verify the gwrk package version and resolve each pin from the named source layer. Reject disabled pins and mismatches. Supply only the verified candidates to the existing selector. Keep the selector and render ordering from feature 044. Keep the pinned candidate's source layer stable across installations. Unpinned machine skills cannot enter the locked result. Installation uses the existing registry workflow.

A mismatch fails before dispatch. Identify the pin and the required version or digest. Direct the caller to provision the pinned package or review and update the tracked lock. Return the established `EffectivePolicy` on success. The [lock data model](../data-model.md#project-policy-lock) defines the persisted values.

## Plugin seed

**Phase 4.** Extend the current method and Commander action.

```typescript
async function seedSkills(options?: {
  dryRun?: boolean;
  taxonomyPath?: string;
}): Promise<void>;
```

`gwrk plugin seed --taxonomy <path> [--dry-run]` passes the path to `seedSkills`. Resolve relative input from the invocation directory. Without the option, keep the current installation-relative default. A missing or invalid input fails before writes. Include the path and show how to supply a valid taxonomy.

Validate the full input before creating skills. Keep the existing named skills and categories. Dry run validates and reports intended changes. Preserve existing complete skills. Publish each new skill from a temporary sibling directory after both files succeed. Remove temporary output on failure so retries can finish. A publication failure names the affected skill and returns exit 1 through the existing signal wrapper. Preserve the command's text output on success.
