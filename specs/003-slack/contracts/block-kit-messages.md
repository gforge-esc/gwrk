# Contract: Block Kit Messages

## Message Types

Each pipeline event maps to a Block Kit message shape.

| Event | Channel | Sections | Actions | FR |
|---|---|---|---|---|
| Phase Start | project channel | Header, Context (branch, agent, tasks) | — | FR-003 |
| Phase Complete | project channel | Header, Context, Results | `[✅ Merge]` `[🔄 Request Changes]` `[🔍 View Full Review]` | FR-003, FR-005 |
| Phase Failure | project channel | Header, Context, Error details | `[🔄 Retry]` `[📋 View Logs]` | FR-003 |
| CI Result | project channel | Header, Test summary, Coverage | — | FR-003 |
| Pulse Summary | project channel | Header, LOC table, Trends | — | FR-003 |
| Done Done! | project channel | Header 🏆, Feature summary, Stats | — | FR-003 |
| Batched Summary | project channel | Header, Event list (collapsed) | — | FR-007 |
| Spec Ready | project channel | Header, Spec path, AC summary | `[✅ Approve]` `[✏️ Revise]` | FR-016 |
| Plan Ready | project channel | Header, Plan path, Phase count | `[✅ Approve]` `[✏️ Revise]` | FR-016 |

## Builder Interface

```typescript
interface MessageBuilder {
  phaseStart(dispatch: DispatchRecord): SlackMessage;
  phaseComplete(dispatch: DispatchRecord, review: ReviewResult): SlackMessage;
  phaseFail(dispatch: DispatchRecord, error: Error): SlackMessage;
  ciResult(dispatch: DispatchRecord, ci: CIResult): SlackMessage;
  pulseSummary(pulse: PulseSnapshot): SlackMessage;
  doneDone(feature: string, stats: FeatureStats): SlackMessage;
  batchedSummary(events: SlackEvent[]): SlackMessage;
  specReady(feature: string, specPath: string): SlackMessage;
  planReady(feature: string, planPath: string, phaseCount: number): SlackMessage;
}
```
interface SlackMessage {
  channel: string;
  blocks: Block[];
  text: string; // fallback for notifications
}
```

## Review Action Payloads

```typescript
interface ReviewAction {
  action_id: 'merge_pr' | 'request_changes' | 'view_review';
  value: string; // JSON: { feature, phase, prNumber }
}
```
