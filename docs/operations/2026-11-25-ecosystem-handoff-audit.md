# Ecosystem handoff audit

Gwrk is usable with operator assistance. The public repository and latest release are not ready for an unattended handoff. The published package predates the accepted implementation. AGY owns release and documentation repair. David retains final merge approval.

## Audited baseline

| Surface | Verified source |
|---|---|
| Live hosted release | bb15497bfeff881e4597972438e586ca98100b56 |
| Core develop | bb15497bfeff881e4597972438e586ca98100b56 |
| Core main | 3fba0bf6fee15cd86da4f6762d72b092fc71d1cf |
| Latest GitHub release | cli-v1.6.0-beta.1, published November 6 |
| Companion main | 99f7f4733120e3e86380acd81f98937ada8766e3 |

Assessment date is November 25, 2026 in America/Denver. GitHub API observations and a downloaded release archive establish the public baseline. Source inspection covers the accepted develop tree. Live observations in this audit are unauthenticated HTTP checks. The preserved hosted acceptance supplies the authenticated evidence.

## Readiness

| Area | Verdict | Evidence |
|---|---|---|
| Hosted security acceptance | Ready for pilot use | Prior live acceptance and independent review |
| Current core package contents | Passes bounded smoke | Built and exercised outside source checkout |
| Public download | Blocks handoff | Old source and missing current functionality |
| Human getting-started path | Needs repair | Install and hosted setup are not joined |
| Consumer-agent entry | Needs repair | No concise canonical consumer agent guide |
| Ecosystem navigation | Needs repair | Core README lacks portal link |
| Companion registry integrity | Passes | All 16 entries reproduce exactly |
| Real project hosted execution | Unverified | Only pilot project acceptance established |
| New release publication | Pending | AGY preparing beta2 candidate |

## Blocking findings

### Release source is stale

The latest GitHub release and default main branch point to 3fba0bf6. Accepted develop is 83 commits ahead. Both old and new trees report package version1.6.0-beta.1. The version alone cannot distinguish the public download from the accepted implementation.

Downloaded asset gwrk-cli-v1.6.0-beta.1.tgz has 517 entries and SHA256 5ea934d9098744775a06f50bea14fbef9482830ae6c7261d8c39d2681b8ebe94. Its inventory lacks pnpm-lock.yaml, the Google token verifier adapter, architecture-context module and release manifest. Workflow prompts are bundled, despite active documentation claiming they are missing. GitHub marks this beta release as not a prerelease.

Required repair: prepare a new beta version with final source identity and verified package. Promote approved code through the repository branch policy. Publish a new tag and immutable assets after David's merge approval. Preserve the old tag. Do not replace old assets under the same version.

### Reader entry points describe an older product

README is identical on main and develop. It labels gwrk alpha six times. It omits the hosted URL and starts installation without first obtaining the source. Its ship example omits isolation and iteration bounds. CONTRIBUTING and SUPPORT also retain alpha messaging. SECURITY describes a local-only tool and excludes local-access threats without explaining the hosted service.

Required repair: distinguish consumer setup from contributor setup. Document hosted authentication, project authorization, credential lifecycle and reporting scope. Clearly identify archived research and review receipts as historical material.

### Project onboarding lacks one complete path

The Getting Started guide assumes .gwrkrc.local.json.example already exists in the user's repository. It lists the retired Gemini backend. It uses gwrk's own hosted feature as the sample task. Installation, architecture selection, framework packs, project ADRs, agent login, local versus hosted execution, server enrollment, repository availability and permissions do not form one walkthrough.

Required repair: provide separate fresh-project and existing-project paths. Explain that init adds target context without proving conformance. Separate user steps from operator steps. Verify the walkthrough on a clean project outside the gwrk checkout.

### Agent handoff needs consumer context

Gwrk's AGENTS.md governs contributors to gwrk. It is not a template for every consumer repository. A consumer agent needs its project's instructions and architecture decisions, a task boundary, the installed gwrk identity and the approved execution mode. Browser Google login is not an automation credential or a project permission grant.

Required repair: publish a short versioned agent entry guide. The handoff must reference the target checkout, approved task, decision index, validation expectations and merge authority. Hosted use must identify the enrolled project and protected origin-bound credential file. Never place a key in the prompt.

### Authentication examples need correction

The CLI guide names a gwrk_ak_v1_ prefix. The implementation accepts gwrk_v1.<id>.<secret>. API examples assume a pilot operator key at an AWS host-local path. The session example assumes a cookie name without explaining the actual proxy session configuration.

Required repair: use verified CLI flags and protected credential files. Label host-admin commands as operator-only. Explain that Google login does not create role bindings. Do not teach manual browser cookie extraction as onboarding.

### Navigation is incomplete

The live portal links seven GitHub product and architecture pages under develop. It has no prominent repository home, release, install or support destination. The core README has no portal link. Companion README explains plugins but has no reciprocal entry path to the hosted product and supported core install.

The public portal returned200 with409721bytes. Public probes returned404 at /docs, /getting-started.html, /llms.txt and /openapi.json. /api-reference.html returned401. Embedded Sphinx content includes relative .html links that can leave the hash-based portal and reach an unserved or protected URL. A missing llms.txt is not itself a blocker. No new route is required just to adopt that convention.

Required repair: prominent reciprocal links across portal, core and companion. Use one canonical guide source with a human entry and an agent entry. Verify rendered navigation rather than only repository link existence. Link versioned technical contracts where exact compatibility matters.

## Packaging and compatibility risks

1. scripts/install.sh resolves latest GitHub release. Today that installs the stale package. It removes the version directory before replacement and checks no archive digest. Its frozen dependency install falls back to an unfrozen install. The old archive contains no lockfile. The new Linux installer and release-manifest flow need a documented distinction from this legacy path.
2. package.json permits Node18. Contributor docs say Node20 or newer. CI covers Node20 and22. Linux packaging requires Node22 or newer. Publish a tested support matrix with separate local and hosted requirements.
3. The accepted release workflow builds Linux assets with a lockfile, checksum and inventory manifest. The currently published release has only its older tarball. A successful workflow definition does not establish a successful new release build.
4. Current portal changes affect closed runtime roots. Regenerating it for new docs changes runtime provenance. A package-version update can also affect release identity. Preserve accepted proof and require new proof where applicable. Do not deploy new runtime content under the old signed claim.
5. Plugin contracts are newer than the public core release. The companion registry needs an explicit compatibility statement. Manifest defaults are compatibility aliases, not verified model promotions.

## Checks performed

| Check | Result |
|---|---|
| GitHub main, develop and release identity | Verified divergence |
| Published tarball hash | Matches GitHub asset digest |
| Published tarball inventory | Current modules and lockfile absent |
| Accepted source build | Passes |
| Current packRelease packaging | Passes |
| Packaged CLI version and help outside source | Passes |
| Packaged init help | Passes |
| Fresh context-only init twice | Passes |
| Existing context-only init twice | Passes |
| Existing project identity and source preservation | Passes |
| Packaged fresh context-only init | Passes |
| Packaged built-in plugin listing after init | Passes |
| Packaged plugin doctor | Passes with empty external install set |
| Packaged ADR check | Passes |
| Active entry-doc relative file links | No missing files |
| Companion registry reindex using accepted core | 16 of16 entries unchanged |
| Live public portal | HTTP200 |

The package smoke used isolated home and project directories. It reused installed dependencies and ran on local Node26.13.0. It is not a fresh dependency install or a native Linux release proof. The private audit package still reports1.6.0-beta.1 because it reproduces the accepted source. It is not the new public release candidate.

The initial fresh-init fixture lived below gwrk's own checkout. Init correctly rejected that nested project. The corrected fixture lives outside gwrk and passes. This was a test-fixture issue, not an init defect. Plugin listing before project initialization correctly requires configuration. The post-init command passes.

## Companion scope

Companion main contains the merged external discovery and framework guidance. Reindexing an isolated archive through current core reproduced all16 registry entries with no changed version or digest. Its README distinguishes bundled agents from external agents and preserves independent model judging. These are verified strengths.

Remaining checks include a fresh external plugin install, doctor validation of that installed plugin, supported-core compatibility documentation, plugin author guidance and reciprocal navigation. No companion CI is configured. Existing local compatibility receipts remain valid historical evidence. They do not substitute for a new end-to-end consumer install check.

## Work assigned

| Owner | Branch | Outcome |
|---|---|---|
| AGY core worker | codex/release-handoff-beta2-nov25 | Core docs and beta2 packaging candidate |
| AGY companion worker | codex/ecosystem-handoff-nov25 | Companion docs and consumer install checks |
| Codex | Current chat | Audit and independent review |
| David | Final approval | Merge and publication authorization boundary |

Each writer has a separate worktree. Neither worker may modify the live service or enroll work projects. New source requires final-head CI and affected native verification. AGY records work under .runs/handoff-audit-nov25. No completion date has been committed.

## Completion dependency

Consumer docs and companion compatibility must agree with the actual CLI. Final source then needs package construction, isolated install checks, required CI and affected native proof. David's approved source promotion precedes the public tag and release assets. The portal must only advertise the new public install once that install exists.

A first real project task remains the final daily-use validation. It must produce attributable definition, implementation, review and harvest evidence. Slack and live model qualification need their own real-account evidence. No such evidence was created by this audit.

## Evidence

- Public release: https://github.com/gforge-esc/gwrk/releases/tag/cli-v1.6.0-beta.1
- Accepted source: https://github.com/gforge-esc/gwrk/tree/bb15497bfeff881e4597972438e586ca98100b56
- Companion source: https://github.com/gforge-esc/gwrk-plugins/tree/99f7f4733120e3e86380acd81f98937ada8766e3
- Local audit receipts: /Users/gonzo/Code/gwrk/.runs/handoff-audit-nov25/
- Hosted acceptance: /Users/gonzo/Code/gwrk/.runs/aws-hosted-pilot-nov23/PORTAL-DEPLOYMENT-CHECKPOINT.md

This audit covers release identity, package inventory, consumer commands, documentation, entry navigation, project onboarding, security guidance and companion integrity. It does not claim a fresh security penetration test or live Wisecode rollout.
