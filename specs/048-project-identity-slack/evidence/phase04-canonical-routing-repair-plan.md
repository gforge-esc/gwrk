# Canonical routing repair plan

The second bounded run left seven reproduced failures across delivery and presence batching. Preserve its source and the retained review patch. Repair the shared routing decisions before another review dispatch.

## Cause

The adapter and both server send paths resolve the same context independently. An explicit cleared thread is later reconstructed from recipient.threadTs. Presence queues also keep the first recipient while batching messages with different routes. Global presence state supplies missing scoped user context.

## Implementation

Extract the shared routing decisions into a pure helper under `src/domain/`. Keep registry reads and Slack API calls in the outer adapters. Retain the current NotificationPort and public server interfaces. Use a canonical resolved route downstream so the sender cannot reconstruct a thread that routing has cleared.

Validate every supplied project identity before choosing one. Conflicting event and option project IDs must fail closed. Apply the same recipient surface and workspace checks in adapter.notify, notifySlack and sendSlackMessage. If a project binding and recipient both name a workspace, they must agree. Verify and post through the same captured Slack client. A missing auth.test cannot establish workspace authority.

For feature delivery, reject conflicting message and recipient channel or thread hints. Use a stored feature thread only when its workspace and channel still match the current project binding. Preserve an already accepted recipient route. Clone caller messages before deriving routing fields.

Combine all opsOnly inputs with Boolean OR. An ops notification uses the enrolled ops channel and has no feature thread. If the ops channel is absent, skip delivery. Clear the recipient's thread alongside the message thread. Direct accepted-recipient adapter delivery must also remain unthreaded when opsOnly is set. Ephemeral delivery uses postEphemeral and follows the same routing validation.

Keep away queues owned by project and explicit recipient user. A scoped notification without an explicit user must not inherit the legacy global user. A failed or unknown scoped presence lookup defaults to active. Preserve legacy behavior only for the unscoped default path.

Partition a queued recipient's messages by their effective channel and ops-only state. Preserve single-thread routed message.thread_ts. Keep different feature threads separate or send a thread-free summary with a thread-free recipient. Never merge ops-channel alerts into feature-channel batches. A flush must not clear another project or user's queue.

Remove the explicit any casts named by review. Keep the gate executable. Preserve the cleared Telegram default-disable behavior. Do not introduce live Slack calls or project enrollment.

## Verification

The restored review patch fails seven cases in `/tmp/gwrk-slack-phase4-remaining-route-boundaries-red.log`. It covers ops-only threading and conflicting context. It also covers cross-user presence fallback and mixed-route flushing.

Keep those behavioral assertions. Add focused pure-helper coverage for the canonical route decisions. Run the full Phase 4 gate with build and lint. Preserve all prior review history. Treat unrelated improvements separately. Phase 4 stays open until independent code review, UAT and final-head CI pass.
