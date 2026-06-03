# Phase 13: Grounding Injection Gap Matrix

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-L25-005 | `gwrk init` MUST provision core workflows and project grounding dirs | unit | src/commands/init.test.ts | ✅ | |
| FR-L25-008 | `WorkflowRuntime` MUST dynamically inject project knowledge documents | unit | src/engine/agent.test.ts | ✅ | |
| FR-ADR009-001 | Domain ontology MUST be injected before information hierarchy and UX posture | unit | src/engine/agent.test.ts | ✅ | |
| US-014 | Provision Global Home | unit | src/commands/init.test.ts | ✅ | |
| US-019 | Inject Domain Ontology and Posture | unit | src/engine/agent.test.ts | ✅ | |
| TC-013 | Grounding Injection Order (ADR-009) | unit | src/engine/agent.test.ts | ✅ | |
| TR-012 | Unit test `dispatchToAgent()` context injection logic | unit | src/engine/agent.test.ts | ✅ | |
