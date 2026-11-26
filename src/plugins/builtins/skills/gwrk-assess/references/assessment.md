# Assessment contract

Report evidence against the declared target and propose ordered features. Initialization establishes context only. Blocked: none when source access is available.

## Inspection

Inspect the runtime entry points and representative modules from every architectural layer. Follow imports to infrastructure implementations. Inspect composition and dependency wiring. Inspect filesystem and network access in domain modules. Inspect clock and environment access too. Inspect mutable module state and hidden results.

Compare documented decisions with executable checks. Identify checks that ignore relevant import forms or code paths. Inspect language standards and framework rules for conflict with the architecture. Inspect initialization and dispatch for consistent context.

Assess test design and execution evidence. Distinguish missing tests from tests that pass without asserting the required behavior. Preserve existing behavior during proposed moves. Do not claim static inspection proves all effects absent.

## Workflow JSON

The workflow returns one object containing `summary` and `assessment`. Include an empty `intents` array.

The assessment has these fields:

- `overview`: current state compared with the target.
- `inspected`: repository-relative files inspected.
- `limitations`: uninspected scope and checks not run.
- `findings`: source-backed gaps.
- `features`: ordered proposed feature specifications.
- `reconciliation`: prior gap map comparisons.

| Object | Required fields |
|---|---|
| Finding | `id` and `rule` |
| Finding | `description` and `evidence` |
| Evidence | `file` and `line` |
| Evidence | `observation` |
| Feature | `id` and `title` |
| Feature | `summary` and `dependsOn` |
| Feature | `findingIds` and `changes` |
| Feature | `acceptance` |
| Reconciliation | `gap` and `status` |
| Reconciliation | `findingIds` and `explanation` |

Evidence uses repository-relative files and one-based lines. Feature identifiers use kebab case. Dependencies refer to other feature identifiers. Put dependencies before dependents. Acceptance criteria specify behavior and boundary tests. Avoid existence-only gates.

Reconciliation status is `confirmed` or `resolved` when evidence supports it. Otherwise use `revised` or `unassessed`. Include every row of a supplied prior gap table. Ground resolved claims in inspected source or executed checks.

## Standalone output

When no machine contract applies, save a Markdown assessment and one proposed spec per feature in the user's requested directory. Include the reviewed revision and working-tree limits. Cite findings in each spec. Existing decisions remain unchanged.
