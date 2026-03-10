# Contract: Bolt Event Handlers

## Event Subscriptions

| Event | Handler | Purpose | FR |
|---|---|---|---|
| `app_home_opened` | `handleAppHomeOpened` | Render/refresh App Home Tab | FR-008 |
| `reaction_added` | `handleReactionAdded` | ✅ reaction-to-approve flow | FR-005 |
| `member_joined_channel` | (builtin) | Bot auto-join on channel create | FR-002 |

## Presence Subscription

```typescript
// Bolt SDK presence subscription
app.client.users.getPresence({ user: userId });
// Polled every 60s, not event-driven (Slack rate limits)
```

## Socket Mode Lifecycle

```typescript
interface BoltAppConfig {
  token: string;          // SLACK_BOT_TOKEN
  appToken: string;       // SLACK_APP_TOKEN
  socketMode: true;       // Always Socket Mode (TC-001: air-gapped)
  port: number;           // Not used (Socket Mode), but required by Bolt
}

interface BoltLifecycle {
  start(): Promise<void>;     // Connect to Slack via WebSocket
  stop(): Promise<void>;      // Graceful disconnect
  isConnected(): boolean;
}
```

## Integration with Build Server

The Bolt app runs inside the Fastify build server process:
- `src/server/slack.ts` — Bolt SDK `App` instance, started on `server:ready`
- Shutdown on `server:shutdown` event
- Slack events trigger actions against the dispatch queue and git manager
