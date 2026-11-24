# Hosted auth config loader review

GO for component commit `3db449bcb22be9df36ef30dd8c2858c0f8f1e093`. No blocking findings. This review clears typed-auth loader preparation only. Startup wiring and Phase6 completion remain pending.

## Scope

The clean candidate adds 22 lines to config.ts and one focused test file. Both hashes match the retained manifest. The reviewed config domain schema remains unchanged. The prepared reader and factory remain unchanged. Status and the three Phase6 caller tests also remain byte-identical to base `70c5a15620bfe194f9ee118c772dbd24919621bb`.

## Behavior

The exported config schema reuses the frozen HostedAuthConfigInputSchema without duplicating auth validation. Missing auth stays absent. An empty object and partial fields remain partial. Existing project-to-local-to-global precedence remains intact. The loader never injects GWRK_AUTH environment values or fills hosted defaults.

Each parsed source validates its own auth object before merging. Invalid earlier values cannot disappear behind a valid later overlay. Unknown keys and malformed typed values produce a static auth error without their values or key names. The pure resolver still owns completeness and typed-versus-environment conflicts.

The change adds no auth-file reads or network effects. It retains normal config-file reads and existing webhook environment injection. It leaves ordinary non-auth config behavior unchanged. Existing optional-overlay invalid-JSON handling also remains unchanged. This component does not claim hosted startup denial for a malformed JSON overlay. The later startup caller must preserve its approved fail-closed behavior.

## Evidence

The authoritative corrected-fixture RED reports 58 failed cases and one absence control pass. Earlier dependency and incomplete-fixture failures remain separately recorded. They do not serve as production RED evidence.

The final receipt passes 156 tests: 59 loader cases plus 24 existing config cases and 73 pure resolver cases. The unchanged AUTH-17 config caller passes. Eight unrelated startup cases were skipped and remain unclaimed. Build and normal hooks pass. Lint passes across 504 files. I read the full diff and retained logs without repeating heavy tests.

## Follow-up

No separate nonblocking code finding. Compose this loader with the reviewed factory and status components before completing the startup callers. Preserve the caller regressions and full Phase6 gate. This GO grants no listener or deployment clearance.
