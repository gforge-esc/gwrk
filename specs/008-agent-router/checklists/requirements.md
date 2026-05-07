# Requirements Checklist: 008-agent-router

## User Stories
- [ ] US-001 (Quota-Aware Backend Selection) passing
- [ ] US-002 (Fallback Chain on Failure) passing
- [ ] US-003 (Quota Probing) passing
- [x] US-004 (Agent Registry Configuration) passing
- [ ] US-005 (SQLite Learning from Outcomes) passing
- [ ] US-006 (Graceful Degradation on Probe Failure) passing
- [ ] US-007 (Selection Recording) passing

## Functional Requirements
- [ ] FR-001 (BackendSelector — quota-first selection) passing
- [ ] FR-002 (QuotaProber — interactive-scrape + cache + optimistic) passing
- [ ] FR-003 (Availability check — quota > 0%) passing
- [ ] FR-004 (Fallback chain, max 3 attempts) passing
- [x] FR-005 (Registry Zod validation with quotaProbe config) passing
- [ ] FR-006 (SQLite success rate tiebreaker) passing
- [ ] FR-007 (Probe failure → optimistic assumption) passing
- [ ] FR-008 (routing_decisions table with quota columns) passing

## Testing Requirements
- [ ] TR-001 (Quota-based selection unit test) passing
- [ ] TR-002 (Fallback chain unit test) passing
- [x] TR-003 (Registry validation unit test) passing
- [ ] TR-004 (SQLite tiebreaker unit test) passing
- [ ] TR-005 (Probe timeout + optimistic fallback test) passing
- [ ] TR-006 (Routing decisions recording test) passing
- [ ] TR-007 (Quota cache TTL test) passing
- [x] TR-010 (Task classification unit test) passing
