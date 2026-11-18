# Architecture-aware policy selection

Carry the project architecture and standards through initialization, workspace profiles and agent prompts. Blocked: shared prompt delivery depends on unified routing (043).

## Requirements

- FR-001. Preserve architecture and principles when profiles resolve language, framework and workspace toolchains. Existing projects without a selection keep their current profile behavior.
- FR-002. Compose shared architecture decisions with language guidance and compatible framework rules. Support declared architecture and principle selectors in plugin manifests. Report missing or incompatible bindings without silently substituting unrelated rules.
- FR-003. Add a JavaScript baseline. Scope gwrk repository conventions to gwrk. Check the TypeScript and Python standards against the selection contract. Apply the same contract to Go and Rust standards and external framework packs.
- FR-004. Keep `gwrk init` deterministic and model-free. Generate proposed context for an existing project without certifying its current code. Preserve user-authored ADRs and managed boundaries on repeat runs.
- FR-005. Define precedence for project overrides and make the effective policy available to the shared prompt route. Keep checks inactive until explicit activation or assessment.

## Acceptance

- TR-001. A polyglot fixture preserves shared design metadata while resolving language and framework per workspace.
- TR-002. New and existing projects compose the chosen architecture with compatible language and framework guidance. Unrelated and repository-specific rules stay out.
- TR-003. A framework with no compatible policy returns a clear gap. Legacy manifests continue to load under their previous scope.
- TR-004. Fresh and repeated init calls make zero agent dispatches. Existing code and human-owned ADRs survive unchanged. Architecture context and prompt bindings match the selection.
