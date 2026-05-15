| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-014 | Define from Slack | E2E/Integration | src/server/slack-commands.test.ts | ✅ | |
| FR-015 | define slash command | Unit | src/server/slack-commands.test.ts | ✅ | |
| FR-016 | define event bridge (spec) | Integration | src/server/routes/notify.test.ts | ✅ | |
| FR-016 | define event bridge (plan) | Integration | src/server/routes/notify.test.ts | ✅ | |
| FR-016 | specReady message | Unit | src/server/slack-messages.test.ts | ✅ | |
| FR-016 | planReady message | Unit | src/server/slack-messages.test.ts | ✅ | |
| FR-005 | approve_spec action | Unit/Integration | src/server/slack-actions.test.ts | ✅ | |
| FR-005 | approve_plan action | Unit/Integration | src/server/slack-actions.test.ts | ✅ | |
| FR-005 | revise_spec action | Unit/Integration | src/server/slack-actions.test.ts | ✅ | |
| US-015 | Conversational Agent | Integration | src/server/slack-agent.test.ts | ✅ | |
| FR-006 | Agent Mentions | Integration | src/server/slack-agent.test.ts | ✅ | |
| FR-017 | Skills in Slack | Integration | src/server/slack-agent.test.ts | ✅ | |
| US-010 | Ship loop notify bridge | Integration | src/server/slack-notify.test.ts | ✅ | |
| FR-014 | Webhook-first | Unit | src/utils/slack-webhook.test.ts | ✅ | |
| US-013 | Multi-channel topology | Integration | src/server/slack-notify.test.ts | ✅ | |
| FR-013 | opsChannelId routing | Integration | src/server/slack-notify.test.ts | ✅ | |
