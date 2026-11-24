# AWS hosted pilot plan

Deploy one private pilot runner in David's AWS account. Public application access remains blocked until Google login and scoped API credentials pass live acceptance. The coordinator owns deployment. Blocked: production authentication implementation and live credentials.

## Approved scope

David approved core PR 240 followed by companion PRs 2 through 4. He then authorized AWS deployment at `gwrk.gforge.ai`. Google login and API key security are required before public exposure. Alert David before Google authentication setup. Preserve the skills-connection Google configuration.

Retain ADR-006 for agent ports and ADR-007 for dispatch through WorkflowRuntime. Retain ADR-008 for bounded execution and ADR-011 for inward dependencies. Use observed RED tests before production repairs. No live project enrollment belongs to infrastructure preparation. Telegram remains disabled.

## Phases

| Phase | Output | Owner | Rollback |
|---|---|---|---|
| 1 Authentication | Reviewed Google and API credential adapters with behavioral tests | Auth implementation worker | Remove unexposed release |
| 2 Private host | Dedicated EC2 instance and encrypted data storage | Coordinator | Stop instance and retain tagged data volume |
| 3 Private installation | systemd runner behind a loopback listener | Coordinator | Stop service and restore prior release |
| 4 Restricted acceptance | Real login and credential denial tests through restricted HTTPS | Coordinator | Close HTTPS ingress and stop gateway |
| 5 Public gateway | Authenticated HTTPS after explicit gate evidence | Coordinator | Remove public ingress and DNS record |

Phase 2 can proceed while phase 1 runs. Phase 3 requires both phases. Phase 4 requires phase 3 and Google client setup. Phase 5 requires every acceptance result. Each phase has one writer per feature branch. Infrastructure commands use explicit AWS profile and region. Save resource IDs and changes in a private deployment ledger before continuing.

## Host selection

Use profile `gforge-dev` in `us-east-2`. Read-only checks confirm its account owns the gforge.ai hosted zone. Use a dedicated security group in the default VPC. Do not alter existing project resources. Select one `t3a.medium` Linux instance for x86 provider CLI compatibility. Use standard CPU credits. Require IMDSv2 and encrypted gp3 volumes. Keep a 32 GB root volume and a separate 20 GB data volume.

Initial inbound access is SSH from the operator's current IPv4 address only. Do not open HTTP or HTTPS globally during bootstrap. The gwrk origin binds to loopback. After synthetic security gates pass, canonical DNS and trusted TLS support operator-restricted HTTPS tests. Those tests precede worldwide gateway ingress. Never expose the application port through EC2 or container publishing. Do not copy local AWS credentials to the host.

## Cost receipt

The AWS regional public price list reports Linux shared `t3a.medium` at USD 0.0376 per hour. It reports gp3 storage at USD 0.08 per GB-month. AWS charges USD 0.005 per hour for a public IPv4 address. At 730 hours and 52 GB, the baseline estimate is USD 35.26 per month. Transfer and backup usage are additional. No inference consumption is included. No load balancer or NAT gateway is planned.

Sources are the [Ohio price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-2/index.csv) and [public IPv4 pricing](https://aws.amazon.com/vpc/pricing/). Save the retrieved quote with the private deployment record before creating resources. Recheck prices if the instance type changes.

## Security gates

- Verify allowed Google login and reject an unlisted account. Require verified email and stable Google subject identity.
- Reject missing or malformed API credentials with machine-readable errors. Preserve project roles after authentication.
- Reject expired and revoked credentials. Verify rotation and secret-safe storage.
- Reject forged identity headers and direct origin access. Protect detailed health output.
- Protect browser mutations against cross-site requests. Bound requests and avoid logging secrets.
- Retain independent signature verification for provider webhooks. Verify replay handling without duplicate effects.
- Verify reboot recovery and systemd restart. Verify backup restoration before enrolling live projects.

Only sign-in routes may be anonymous. Login completion does not authorize project operations. Retain the core project authorization port after credential verification. Record actual live results separately from synthetic test results.

## Deployment records

Track public architecture and reproducible deployment scripts in this feature. Keep credentials and account inventory in gitignored private state with restricted permissions. Store recovery resource IDs without secrets. Never record a test as passing before observation. If a security gate fails, close access before repair.

## Compatible rollback

Keep the authoritative auth ledger during code rollback. Check migration compatibility before switching releases. If no compatible release exists, stop the service and close ingress. Test backup restoration on isolated state. Never restore an old database to downgrade live code or recover access.
