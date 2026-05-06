# Gap Analysis: 003-slack

**Date**: 2026-03-10 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

## Summary

All 10 Slack-specific implementation files are **greenfield**. Eight support files exist and need modification. One dependency (`@slack/bolt`) needs to be added to `package.json`.

## File-by-File Analysis

### Phase 1: Setup & Provisioning

| File | Status | Detail |
|---|---|---|
| `package.json` | **missing** | No `@slack/bolt` dependency |
| `src/commands/setup-slack.ts` | **greenfield** | Does not exist |
| `src/utils/slack-client.ts` | **greenfield** | Does not exist |
| `src/cli.ts` | **exists (104L)** | No `setup slack` subcommand registered |
| `src/utils/config.ts` | **exists (68L)** | Has `slackChannel: z.string().optional()` — needs expansion to full `SlackProjectConfig` with `channelId`, `channelName`, plus Slack token validation in `~/.gwrk/.env` |

### Phase 2: Server Integration & Channel Management

| File | Status | Detail |
|---|---|---|
| `src/server/slack.ts` | **greenfield** | Does not exist |
| `src/server/index.ts` | **exists (124L)** | No Bolt lifecycle hooks (`server:ready`, `server:shutdown`) |
| `src/server/slack-channel.ts` | **greenfield** | Does not exist |
| `src/commands/init.ts` | **exists (140L)** | Has `--slack <channel>` flag (string only), no Slack API channel creation |
| `src/utils/config.ts` | **exists (68L)** | No `channelId`/`channelName` in schema |

### Phase 3: Block Kit Status Updates

| File | Status | Detail |
|---|---|---|
| `src/server/slack-messages.ts` | **greenfield** | Does not exist |
| `src/server/slack-notify.ts` | **greenfield** | Does not exist |
| `src/commands/ship.ts` | **exists (217L)** | No Slack notification hooks |
| `src/server/dispatch.ts` | **exists (260L)** | No event emission for Slack consumption |

### Phase 4: Slash Commands & Interactive Review

| File | Status | Detail |
|---|---|---|
| `src/server/slack-commands.ts` | **greenfield** | Does not exist |
| `src/server/slack-actions.ts` | **greenfield** | Does not exist |
| `src/server/slack.ts` | **greenfield** | See Phase 2 |
| `src/server/routes/health.ts` | **exists (42L)** | No Slack connection status |

### Phase 5: Presence-Aware Throttling

| File | Status | Detail |
|---|---|---|
| `src/server/slack-presence.ts` | **greenfield** | Does not exist |
| `src/server/slack-notify.ts` | **greenfield** | See Phase 3 |
| `src/server/slack-messages.ts` | **greenfield** | See Phase 3 |

### Phase 6: App Home Tab

| File | Status | Detail |
|---|---|---|
| `src/server/slack-home.ts` | **greenfield** | Does not exist |
| `src/server/slack.ts` | **greenfield** | See Phase 2 |
| `src/server/routes/status.ts` | **exists (55L)** | Status data not exported for Home Tab consumption |

## Contract Coverage Check

| Contract | Methods | Implementation Status |
|---|---|---|
| `contracts/slack-setup.md` | `setupSlack()`, `SlackSetupResult` | ❌ Not implemented |
| `contracts/slash-commands.md` | `SlashCommandHandler`, `CommandContext`, 8 command handlers | ❌ Not implemented |
| `contracts/block-kit-messages.md` | `MessageBuilder.*` (7 methods), `ReviewAction` | ❌ Not implemented |
| `contracts/bolt-events.md` | `BoltLifecycle`, `handleAppHomeOpened`, `handleReactionAdded` | ❌ Not implemented |

## Conclusion

This is a **clean greenfield implementation**. No rework, no conflicts, no wrong implementations. Every task will be `greenfield` or `missing` (for modifications to existing files).
