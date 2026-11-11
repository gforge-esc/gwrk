# Evidence, judging and route lock contract

Store account discovery and evaluation runs under `.runs/models/`. Persist promoted routes in an atomic, credential-free lock at `.gwrk/models/route-lock.<runner>.json`. Blocked: none for schema and CLI contracts.

## Artifact storage and scope

| Artifact | Path | Mutability | Scope |
|---|---|---|---|
| Discovery snapshot | `.runs/models/discovery/<runner>.json` | Overwritten per discovery run | Uncommitted runner observation |
| Evaluation bundle | `.runs/models/evaluations/<evalId>/bundle.json` | Immutable once written | Uncommitted evidence archive |
| Synthetic fixture suite | `tests/fixtures/model-qualification/suite.json` | Git-tracked versioned input | Hermetic cross-provider testing |
| Active route lock | `.gwrk/models/route-lock.<runner>.json` | Atomic temp-file and rename | Reviewable workspace and runner pin |

## Deterministic gates and two-judge policy

| Rule | Requirement | Failure action | Phase |
|---|---|---|---|
| Candidate presence | Model and effort exist in matching runner snapshot | Reject before smoke probe | Phase 1 |
| Alias exclusion | Concrete model ID only, never `default` or `auto` | Reject candidate pin | Phase 1 |
| Deterministic gates first | Required sections, ADR constraints, RED to GREEN and forbidden paths pass | Short-circuit before judges and keep incumbent | Phase 3 |
| Repeat calibration floor | Minimum three independent runs per required fixture | Mark incomplete evaluation ineligible | Phase 3 |
| Judge independence | Two fixed frontier judges from distinct providers and distinct families | Abort when the configured judges are unavailable or fail independence checks | Phase 1 and Phase 3 |
| Blinded order randomization | Remove route identity metadata and randomize candidate order per comparison | Reject unblinded packet | Phase 1 and Phase 3 |
| Citation completeness | Each cited reference resolves to a supplied input, output or gate artifact | Reject malformed verdict and keep incumbent | Phase 1 and Phase 3 |
| Unanimous non-regression | Both judges report zero candidate regression and candidate win | Record disagreement and keep incumbent | Phase 1 and Phase 3 |

## Role scoring and handoff matrix

| Role or handoff | Primary rank | Secondary rank | Repeat floor |
|---|---|---|---|
| `define` | Requirement, ADR and reference coverage plus valid plan gates | Elapsed duration | 3 runs |
| `implement` | Behavioral equivalence with all deterministic gates passing | Median elapsed time to passing gates | 3 runs |
| `review` | Seeded defect recall without false-positive task reopenings | Elapsed duration | 3 runs |
| `define` to `implement` handoff | Candidate plans executed by one fixed fast implementer | Handoff gate pass rate | 3 runs |
| `implement` from fixed plan | Fixed qualified plan executed across candidate implementers | Median elapsed time to passing gates | 3 runs |

## Atomic route lock schema

```typescript
export interface PinnedRoleRoute {
  role: "define" | "implement" | "review" | "judge";
  routeMode: "pinned" | "provider-default";
  backend: string;
  provider: string;
  family: string;
  modelId: string;
  effort?: string;
  fallbackRoutes: Array<{
    backend: string;
    provider: string;
    family: string;
    modelId: string;
    effort?: string;
    evaluationId: string;
  }>;
  toolVersions: {
    cliVersion: string;
    adapterVersion: string;
  };
  evidence: {
    evaluationId: string;
    snapshotHash: string;
    evaluationBundleHash: string;
    fixtureSuiteHash: string;
    workflowPromptHashes: Record<string, string>;
    judgeVerdictHashes: [string, string];
  };
}

export interface RouteLockDocument {
  schemaVersion: 1;
  workspaceId: string;
  runnerProfile: string;
  updatedAt: string;
  routes: Partial<Record<"define" | "implement" | "review", PinnedRoleRoute>>;
  judges?: [PinnedRoleRoute, PinnedRoleRoute];
  previousLock?: Omit<RouteLockDocument, "previousLock">;
}
```

## Promotion consistency

Bind an evaluation to the incumbent lock digest, requested runner, role and exact candidate identity. Revalidate those inputs under the same lock used to write the new route. Reject promotion if another writer changed the incumbent during evaluation. Preserve the previous lock only after the replacement validates. Exercise concurrent promotion and rollback against the same runner.

## Staleness, fallback and credential invariants

`resolveQualifiedRoute` compares the lock's `fixtureSuiteHash` and `workflowPromptHashes` against current workspace digests. It also checks that `modelId` remains available in the latest runner catalog unless `routeMode` is `"provider-default"`. When a digest changes or a provider removes the model, resolution marks the pin `stale` and requires requalification. Valid staleness reasons include changed prompts, fixtures, tool versions and eligible models. Hash the effective prompt inputs, including applicable project rules and decision records, so a change to expanded instructions expires the evidence.

Pinned execution uses only `fallbackRoutes` that carry their own passing `evaluationId` for the same role and runner profile. Existing explicit agent selection resolves through the same lock and report `unavailable_pin` when that backend lacks a qualified route for the role. Explicit `--route provider-default` bypasses model pinning while labeling `routeMode: "provider-default"` and `observedModel` (`string | "unknown"`) in run manifests.

`assertNoSecretMaterial` scans every discovery snapshot, evaluation bundle and route lock before write. It rejects bearer tokens and `sk-` or `AIza` prefixes. It also rejects `ghp_` or `xoxb-` prefixes and authorization or cookie headers. Email addresses and environment secret values fail the same check. Cross-provider judging uses only synthetic fixtures under `tests/fixtures/model-qualification/`.

## CLI contract

All subcommands wrap execution in `withSignal` so stderr emits `[exit:N | Xs]` per the CLI output contract (`ADR-004`). Every subcommand supports `--format json` and includes concrete `Examples:` blocks in `--help`.

| Command | Kind | Mutates lock | Failure exit |
|---|---|---|---|
| `gwrk models discover` | Query and snapshot generator | Never | `1` when all requested backends fail |
| `gwrk models evaluate` | Verifier | Never | `1` on gate failure, malformed output or judge disagreement |
| `gwrk models promote` | Explicit mutator | Atomic write or rollback | `1` on stale hashes, absent model, failed verdict or secret match |
