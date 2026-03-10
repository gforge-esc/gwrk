# Requirements Checklist — 003-slack

## User Stories
- [ ] US-001: Automated Slack App Provisioning
- [ ] US-002: Channel-Per-Project
- [ ] US-003: Status Updates
- [ ] US-004: Slash Commands
- [ ] US-005: Interactive Review Buttons
- [ ] US-006: Threaded DUT Conversations
- [ ] US-007: Presence-Aware Notifications
- [ ] US-008: App Home Tab Dashboard
- [ ] US-009: Slack Setup Verification

## Functional Requirements
- [ ] FR-001: `gwrk setup slack` — app creation, token write, Socket Mode, idempotent
- [ ] FR-002: Channel creation during `gwrk init` / `gwrk new`
- [ ] FR-003: Block Kit status messages (7 event types)
- [ ] FR-004: 8 slash commands registered and handled
- [ ] FR-005: Interactive review buttons + ✅ reaction-to-approve
- [ ] FR-006: `/dream` DUT threaded conversations + spec generation
- [ ] FR-007: Presence-aware notification throttling (active=immediate, away=batched)
- [ ] FR-008: App Home Tab with 5 sections + auto-refresh
- [ ] FR-009: `gwrk setup slack --verify` — 4-point verification

## Error States
- [ ] FR-001 error states defined and implemented
- [ ] FR-002 error states defined and implemented
- [ ] FR-003 error states defined and implemented
- [ ] FR-004 error states defined and implemented
- [ ] FR-005 error states defined and implemented
- [ ] FR-006 error states defined and implemented
- [ ] FR-007 error states defined and implemented
- [ ] FR-008 error states defined and implemented
- [ ] FR-009 error states defined and implemented

## Data Model
- [ ] DM-001: Slack config in `~/.gwrk/.env`
- [ ] DM-002: Project Slack state in `.gwrkrc.json`
- [ ] DM-003: Notification queue (in-memory)
- [ ] DM-004: DUT thread state (SQLite)

## Technical Constraints
- [ ] TC-001: Air-gapped — Socket Mode only, no inbound HTTP
- [ ] TC-002: Fail-fast config — Zod validation, `process.exit(1)` on missing tokens
- [ ] TC-003: No CDN — all Block Kit JSON generated locally
- [ ] TC-004: Single-user — one workspace, one user
- [ ] TC-005: Bolt SDK — `@slack/bolt` with Socket Mode
- [ ] TC-006: Token storage — `~/.gwrk/.env`, never committed
- [ ] TC-007: TypeScript only — no `.js` in `src/`
