# Requirements Checklist: 005-parallel-dispatch

## User Stories
- [ ] US-001 (Dispatch Independent Tasks Concurrently) passing
- [ ] US-002 (Isolated Sandboxes) passing
- [ ] US-003 (Sequential Merge Ordering) passing
- [ ] US-004 (Capacity Gating and Rate Limiting) passing
- [ ] US-005 (Conflict Resolution Fallback) passing

## Functional Requirements
- [ ] FR-001 (DispatchOrchestrator concurrent dispatch) passing
- [ ] FR-002 (Sandbox clone via reference/worktree) passing
- [ ] FR-003 (shipPhase hook w/ workDir) passing
- [ ] FR-004 (Sequential merge lock) passing
- [ ] FR-005 (maxConcurrent per backend) passing
- [ ] FR-006 (429 backoff + queue suspenson) passing
- [ ] FR-007 (Merge conflict recovery) passing

## Testing Requirements
- [ ] TR-001 (Concurrency limit unit test) passing
- [ ] TR-002 (Sandbox isolation unit test) passing
- [ ] TR-003 (Merge lock unit test) passing
- [ ] TR-004 (Conflict resolution test) passing
