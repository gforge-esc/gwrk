# Architecture context validation

The compiled CLI passes setup acceptance checks. The hermetic suite passes with the assessment changes. Blocked: none for setup validation.

## Evidence

| Check | Target | Result | Verdict |
|---|---|---|---|
| TypeScript build | No compiler errors | No errors | Passes |
| Hermetic suite | All active tests pass | 1,744 passed | Passes |
| Project lint | No errors | No errors | Passes |
| Decision check | Citations and index valid | Valid | Passes |
| CLI acceptance | All setup scenarios pass | Six passed | Passes |
| Skill validation | Valid frontmatter and references | Valid | Passes |
| Isolated Codex installation | Package installs successfully | Installed | Passes |
| Claude manifest validation | Valid plugin manifest | Metadata warnings only | Passes |
| Gemini live discovery | Installed client loads extension | Client unavailable | Unmeasured |

The suite skips seven tests and records six todo cases. Four test files remain skipped under the existing hermetic-suite configuration. This result does not claim the quarantined integrations pass.

## Acceptance scenarios

The reproducible script is `scripts/architecture-context-uat.py`. It uses temporary projects and agent executable traps.

1. Full initialization creates a selected architecture with Python and FastAPI guidance.
2. Re-init preserves identical context and decision identities.
3. Assessment preview invokes no agent executable.
4. Existing-project setup preserves source and personal settings with a custom corpus.
5. Edited generated context survives re-init with an explicit conflict.
6. Client packages share the canonical assessment skill and reference.

## Self-application

The updated init ran against gwrk with `hexagonal-functional` and the requested principles. It created the Proposed desired-architecture decision. Context status is ready. Initialization left code conformance unassessed.

The self-assessment uses the new command through the configured agy backend. Its report and proposed specifications belong under `docs/architecture/assessments/`. The assessment cites the public gap map.

## Test development

Context installation and assessment contract tests first failed because their implementation modules were absent. They later passed with the implementation. CLI tests cover preservation and validated assessment artifacts. The workflow test rejects mutation intents and prose recovery under report-only execution.

## Self-assessment result

The configured agy agent returned eleven findings and six feature proposals. It reconciled all seventeen prior gaps. The original command exposed an event-envelope parsing defect after the agent completed.

A failing adapter test reproduced that defect. The adapter now normalizes the observed response. WorkflowRuntime consumes normalized output. Recorded-response recovery requires successful terminal status and makes no model call.

The installed gwrk command recovered the completed stream and saved the assessment. A second compiled-command acceptance run reproduced the same result. The saved JSON equals the recorded agent payload. Its provenance verifies the stream hash and target hash.

The reviewed report closes the temporary template mismatch. It also narrows transport claims to the remaining evidence. The original agent JSON remains unchanged as data.

Artifacts live in `docs/architecture/assessments/2026-11-11-self-assessment/`. The report links six proposed specifications. The local evidence archive holds the original reference and raw run artifacts.
