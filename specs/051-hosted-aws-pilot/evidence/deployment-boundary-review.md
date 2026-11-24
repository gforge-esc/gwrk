# Deployment boundary review

GO to freeze the deployment mapping for runner tests. Blocked: none in this design scope. Google account selection and policy acceptance remain operator inputs.

The contract names hosted mode and origin plus audience and allowlist and CSRF file settings. Conflicting typed configuration fails closed. Auth file reads remain inside explicit startup. Initialization creates neither an allowed account nor a credential.

Origin secrets remain separate from the root-only gateway directory. Gateway mounting must prove its pinned container identity can read the files while workers cannot. The contract makes no additional OS isolation claim.

The shared child spawn in `src/utils/agent.ts` merges process and adapter environments before spawning. The new pure filter applies after that merge. Explicit task environment cannot restore forbidden keys. Hermetic child tests preserve outbound and native discovery canaries while removing inbound values.

The Phase 7 and 8 additions include the filter and actual-child regression in their gates. No phase ordering changes undermine the approved plan.

Nonblocking precision: freeze production JWKS URL as `https://www.googleapis.com/oauth2/v3/certs`. Google discovery currently publishes that URI with issuer `https://accounts.google.com` and RS256 support. Keep test transport injection separate. No runtime discovery fetch is needed to resolve this constant. [Official discovery](https://accounts.google.com/.well-known/openid-configuration).

Nonblocking consistency: the older Phase 7 `credentials.sh` file description still says it scrubs worker environments. Assign that action explicitly to the shared spawn filter. The new boundary already states that scrubbing in the runner would remove settings needed by the origin.

This is design clearance. No implementation tests ran. No production or host setting changed. Contract and plan hashes are in the adjacent manifest.
