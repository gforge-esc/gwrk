# Contract: Slack Setup

## `gwrk setup slack`

### Input
- `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in environment or `~/.gwrk/.env`
- Optional: `--verify` flag (test-only mode)

### Output (success)
```
Slack app configured for workspace: <workspace-name>
Tokens written to ~/.gwrk/.env
Socket Mode: OK
```
Exit code: 0

### Output (already configured)
```
Slack already configured
```
Exit code: 0

### Output (verify mode)
```
Socket Mode: OK|FAIL
Bot Token: OK|FAIL
App Token: OK|FAIL
Test Message: OK|FAIL
```
Exit code: 0 if all OK, 1 if any FAIL

### Interface
```typescript
interface SlackSetupResult {
  workspace: string;
  tokensWritten: boolean;
  socketModeOk: boolean;
  alreadyConfigured: boolean;
}

function setupSlack(opts: { verify?: boolean }): Promise<SlackSetupResult>;
```
