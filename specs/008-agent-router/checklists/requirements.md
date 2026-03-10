# Requirements Checklist: 008-agent-router

## User Stories
- [ ] US-001 (Automatic Backend Selection) passing
- [ ] US-002 (Fallback Chain on Failure) passing
- [ ] US-003 (Context Size Estimation) passing
- [ ] US-004 (Agent Registry Configuration) passing
- [ ] US-005 (SQLite Learning from History) passing
- [ ] US-006 (Mini-Model Pre-flight) passing
- [ ] US-007 (Selection Recording) passing

## Functional Requirements
- [ ] FR-001 (BackendSelector interface) passing
- [ ] FR-002 (Context size estimation) passing
- [ ] FR-003 (Availability check) passing
- [ ] FR-004 (Fallback chain, max 3 attempts) passing
- [ ] FR-005 (Registry Zod validation) passing
- [ ] FR-006 (SQLite learning with decay) passing
- [ ] FR-007 (Mini-model pre-flight + escalation) passing
- [ ] FR-008 (routing_decisions table recording) passing

## Testing Requirements
- [ ] TR-001 (Selection logic unit test) passing
- [ ] TR-002 (Fallback chain unit test) passing
- [ ] TR-003 (Registry validation unit test) passing
- [ ] TR-004 (SQLite learning unit test) passing
- [ ] TR-005 (Mini-model selection unit test) passing
- [ ] TR-006 (Routing decisions recording test) passing
- [ ] TR-007 (Context estimator accuracy test) passing
