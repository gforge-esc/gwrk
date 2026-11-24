# Model qualification

Give gwrk a repeatable way to discover current models, test them against its workflow prompts and promote qualified models by role. Blocked for integration until unified agent routing exposes the typed model choice and execution evidence.

## Requirements

- Discover models under the same backend, account and runner profile used for execution. Record the CLI and adapter versions. Preserve provider-qualified model IDs and supported effort values.
- Use Antigravity for Google models. Include native Claude and Codex. Add discovery or explicit candidate inputs to enabled external adapters. Keep discovery separate from dispatch and report unavailable adapters.
- Smoke-test the exact requested model and effort. Record whether the provider reports the observed model and preserve unknown values.
- Run existing definition, implementation and review prompts against versioned fixtures. Include a repository, architecture decisions, references and a research brief in a definition fixture. Use deterministic gates and repeat runs.
- Compare qualified candidates with the incumbent. Send blinded evidence to two fixed frontier judges from different providers and families. Retain the incumbent if the judges disagree or a required gate fails.
- Score definition by coverage and executable plan quality. Score implementation by elapsed time to passing gates after equivalent behavior. Test both directions of the spec and implementation handoff.
- Promote through an explicit command. Write an atomic versioned route lock with role, backend, model, effort, fallback order, tool versions and evidence hashes. Invalidate stale evidence when prompts, fixtures or eligible models change.
- Keep provider default available as an explicit route. Surface unavailable pins and fallback reasons. Never include credentials or private account material in the route lock.

## Acceptance

1. Discovery observes new models without editing or releasing the plugin.
2. An absent model or a malformed result cannot be promoted.
3. Deterministic gate failure or judge disagreement leaves the incumbent lock intact.
4. A passing comparison pins the model for its evaluated role and runner. Dispatch uses the pin and reports the observed identity when available.
5. Updated prompts or fixtures trigger requalification. The prior lock remains available for rollback.
6. Synthetic fixtures cover the full cycle. Record live qualification for the enabled local and pilot backends separately.

[Model qualification brief](../../docs/research/2026-11-11-model-qualification.md)
