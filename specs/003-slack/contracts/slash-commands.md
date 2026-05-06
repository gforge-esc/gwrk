# Contract: Slash Commands

## Command Registry

All commands are registered as `/gwrk <subcommand>`.

| Command | Args | Response Type | FR |
|---|---|---|---|
| `/gwrk status [feature]` | optional feature ID | Block Kit (ephemeral) | FR-004 |
| `/gwrk dispatch <feature>` | required feature ID | Block Kit (ephemeral) | FR-004 |
| `/gwrk approve <feature> <phase>` | required feature + phase | Block Kit (in-channel) | FR-004 |
| `/gwrk reject <feature> <phase> <reason>` | required all | Block Kit (ephemeral) | FR-004 |
| `/gwrk pause <feature>` | required feature ID | Block Kit (ephemeral) | FR-004 |
| `/gwrk pulse [repo]` | optional repo path | Block Kit (ephemeral) | FR-004 |
| `/gwrk effort <feature>` | required feature ID | Block Kit (ephemeral) | FR-004 |
| `/gwrk logs <feature> <phase>` | required both | Block Kit (ephemeral) | FR-004 |

## Handler Interface

```typescript
interface SlashCommandHandler {
  command: string;
  handler: (args: string[], context: CommandContext) => Promise<SlackBlockKit>;
}

interface CommandContext {
  userId: string;
  channelId: string;
  projectRoot: string;
  buildServerUrl: string;
}

type SlackBlockKit = {
  blocks: Block[];
  response_type: 'ephemeral' | 'in_channel';
};
```

## Error Response Shape

All command errors return ephemeral Block Kit with a single section:
```json
{
  "response_type": "ephemeral",
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": ":warning: <error message>" }
    }
  ]
}
```
