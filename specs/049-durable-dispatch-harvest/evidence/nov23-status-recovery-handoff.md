# Durable status and recovery handoff

Implement the final durable phase against the cleared coordinator and ingress ports. Blocked: this phase needs its own passing gates and independent reviews. Preserve the existing implementation and review history.

Use `contracts/coordinators-routes-and-cli.md`. Read status through `OperationsStorePort.getOperationsStatus(projectId)`. Preserve canonical project identity and scoped database ownership. Keep operations from two repositories distinct when feature and phase identifiers match. Matching pull request numbers must remain repository-scoped.

Implement all five Phase 6 tasks. Keep `gates/phase-06.sh` as their mechanical gate. Add behavioral tests before production changes. The gate requires manual harvest and unattended recovery tests. It also requires command status and server status coverage.

Route manual harvest through `DurableHarvestService`. Preserve offline local commit harvest. Support explicit project selection and machine output. Keep omitted recipients distinct from explicit null suppression. Preserve the original caller receipt when deriving an approved Slack destination.

Status must show queue age and pending harvest stages. Keep failed gates distinct from closed unmerged work. Report unresolved deliveries and legacy evidence counts. Exit nonzero for unresolved gate failure or failed delivery. Pending and uncertain delivery cannot appear delivered. Keep JSON output parseable under ADR-004.

Health must distinguish daemon liveness from project readiness. Preserve reachability diagnostics from project enrollment. Keep outbox degradation visible. Telegram remains disabled in the pilot. Do not duplicate status SQL when the approved operations port already exposes the required data.

Compose startup recovery before dispatch draining. Verify recorded worker state before relaunch. Preserve lease fencing and receipts across restart. The durable outbox owns durable notification delivery. Do not also call the legacy notifier for the same effect. Reconcile uncertain sends against their saved destination and metadata key.

Use synthetic crash tests for accepted work and started workers. Include unfinished harvest stages and uncertain delivery. Exercise two repositories with colliding identifiers. Prove restart preserves operation identity and run linkage. Preserve bounded transport and shutdown cancellation.

Project enrollment from feature 048 is composed into this parent. Preserve its cleared authorization and readiness behavior while adding durable status and recovery. Update the operator documentation and ADR references to match the final interfaces.

No live deployment or project enrollment belongs to this phase. DNS and Google authentication configuration remain hosted pilot work. No live Slack messages or model promotion belong to this repair.

## Composed interfaces

| Task | Work | Required tests |
|---|---|---|
| Server status, T033 | Add operations status through the approved store | `src/server/routes/status.test.ts` |
| Health, T034 | Add outbox and harvest degradation to project readiness | `src/server/routes/health.test.ts` |
| Startup composition, T035 | Recover and reconcile before draining | `src/server/index.test.ts`, `src/server/unattended-recovery.test.ts`, `src/server/two-repo-isolation.test.ts` |
| Manual harvest, T036 | Use the durable harvest service | `src/commands/harvest.test.ts` |
| Command status, T037 | Render durable status and failure exit codes | `src/commands/status.test.ts` |

All five tasks remain open. Their shared Phase 6 gate also retains project and server command tests. The gate requires the new manual harvest and unattended recovery test files before it can pass.

`OperationsStorePort` lives in `src/ports/operations-port.ts`. Its status method returns `DurableOperationsStatus`. Queue age derives from `queue.oldestQueuedAt`. Harvest status includes pending stages and unresolved gate failures. Delivery status separates pending, uncertain and failed counts. Historical counts identify unverified legacy records. Use these fields instead of querying SQLite from route policy.

`statusRoutes` already accepts project authorization options. Extend that composition without bypassing its read access checks. `healthRoutes` accepts registry, notifier and runner kind options. Preserve its distinction between daemon liveness and verified checkout readiness. Command status already reads operations status for enrolled projects. Extend that path instead of adding another store query.

`startServer` constructs an active registry and a sandbox manager for each root. Preserve its injected ledger and Git environment. Keep its approved backend. `DispatchQueue.accept` persists receipts and schedules later draining. `recoverOnStartup` reconciles durable worker state. `close` cancels scheduling and drains in-flight work. Keep Slack acknowledgment ownership and replay release intact.

`HarvestWatcher` accepts durable dependencies in its final options argument. These include the service and store. Effect ports cover GitHub polling and version control. Execution and notification ports complete the dependency set. Registry-backed polling uses those durable ports. Preserve repository-scoped cursors and saved recipients. Its earlier `harvest` callback belongs to the legacy path. New registry-backed tests must inject durable ports.

## Preparation evidence

The parent fast-forwarded from `8217352b` to reviewed source `c748517a`. Reviewed integration `11e52fc9` is composed in an uncommitted merge. One route conflict combined authorization with durable intake and scoped reads. An automatic merge also introduced duplicate private Git environment field names in the sandbox subclass. Renaming the subclass field preserves both implementations.

HTTP intake returns durable receipts for enrolled projects. Queue reads still expose scoped dispatch records. The enrollment tests now verify receipt identity through the operations store. Queue records retain backend and task assertions. Store records retain root and trunk assertions. Recipient checks cover both surfaces. Explicit null recipients remain suppressed. Authorized reads can return durable operations or scoped legacy records.

The two-repository watcher test now uses the real durable coordinator and SQLite store with synthetic effect ports. It verifies project roots and thread recipients through execution and outbox delivery. Its network guard remains active. An isolated global configuration prevents personal configuration from selecting real transports.

The first composition run retained six failures in `/tmp/durable-composed-initial-red.log`. Explicit null suppression also has separate hosted and local HTTP RED logs. Both paths now preserve null through durable intake. The build failure is in `/tmp/durable-composed-build.log`. The composed focused selection passed 288 tests. One test remained skipped and one remained a todo. Final recipient checks and build results appear in `.runs/durable6-composition-nov23/manifest.json`. The original shutdown and Slack replay review findings remain in task history. Their behavioral regressions run in the shared Phase 5 selection.

Preparation does not implement Phase 6. No ship run, deployment or live qualification occurred. Manual composition and preparation edits remain uncommitted for review.

The reviewed source passed both required continuous integration checks in run `45277163353`. The outer evidence head `0ca9cae4` remains a separate metadata merge for the owner. Its final checks remain required before completion.

## Independent composition clearance

Independent review at `07cb062a` is GO. Build and lint pass. Four focused suites pass 27 tests with one existing todo. See `nov23-independent-composition-review.md`. Final ingress head `0ca9cae4` passes both required CI jobs in run `45278013015`. The outer evidence record is now composed into this parent.
