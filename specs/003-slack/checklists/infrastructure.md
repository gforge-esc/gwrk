# Infrastructure Checklist — 003-slack

## Dependencies
- [ ] `@slack/bolt` installed
- [ ] `@slack/web-api` installed (bundled with Bolt)
- [ ] Vitest configured for Slack module tests
- [ ] Mock strategy defined (Slack API mocks, not live calls)

## Configuration
- [ ] `.gwrkrc.json` schema extended for Slack project config (`channelId`, `channelName`)
- [ ] `~/.gwrk/.env` template documented with `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`
- [ ] `.env.example` updated with Slack token placeholders
- [ ] Zod schema for Slack config validates all required fields

## Build Server Integration
- [ ] Bolt `App` instance starts on `server:ready` event
- [ ] Bolt `App` instance stops on `server:shutdown` event
- [ ] Socket Mode reconnects on `network:up` event (resilience)
- [ ] Slack connection status exposed via `/health` endpoint component

## OAuth Scopes
- [ ] `channels:manage` — create project channels
- [ ] `channels:read` — list channels
- [ ] `chat:write` — post status updates
- [ ] `commands` — register slash commands
- [ ] `reactions:read` — detect ✅ approval reactions
- [ ] `users:read` — presence detection
- [ ] `app_mentions:read` — DUT @mention triggers

## Database
- [ ] SQLite migration for `dut_threads` table
- [ ] `dut_threads` schema matches DM-004

## Testing
- [ ] 10 test files created per TR-001 through TR-010
- [ ] Mock Bolt `App` available for unit tests
- [ ] Integration test with mock Socket Mode
- [ ] All tests pass with `pnpm vitest run src/server/slack*`
