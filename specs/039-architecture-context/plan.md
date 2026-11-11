# Architecture context implementation

Separate context installation from agent-assisted assessment. Keep domain policy pure and persist assessment evidence beside proposed feature specs. Blocked: none.

## Context setup

Use `src/domain/architecture-context.ts` for selection and rendering. Use `src/application/architecture/install-context.ts` for installation orchestration. Use the context-files port for all external operations. The filesystem adapter supplies bundled skill resources and persistence.

Integrate the use case into full init and context-only init. Preserve project decisions and personal configuration. Re-init protects human edits through managed-file hashes.

## Assessment

Use the shared skill as the workflow method. Dispatch through WorkflowRuntime with report-only output. Validate finding coverage and dependency ordering in domain code. Validate evidence paths and lines before persisting results.

The command writes the report and proposed feature specs. It preserves supplied gap maps and records source hashes. Model output cannot execute mutation intents.

## Verification

```bash
pnpm build
pnpm test:ci
pnpm lint
node dist/cli.js define adr --check
python3 scripts/architecture-context-uat.py
```

Run the self-assessment through the compiled command. Review the report and reconcile the prior gap table before accepting the result.
