# Beta repository readiness

The onboarding implementation and operations scope start from the released beta. The beta tree cleanup removes alpha artifacts from the current checkout. Blocked: none for branch preparation.

## Branch review

| Prior branch | Beta evidence | Disposition |
|---|---|---|
| Master remediation and polyglot canary | Ancestors of develop | Retire branch names |
| Registry versioning, lint and telemetry | Ancestors of develop | Retire branch names |
| Agent selection during init | Patch equivalent to merged work | Retire branch name |
| Claude adapter parity | Patch equivalent to merged work | Retire branch name |
| Ontology construction repair | Patch equivalent to merged work | Retire branch name |
| Claude default model handling | Patch equivalent to merged work | Retire branch name |
| Decision record phases 5 to 11 | Same patch in merged daily-driver work | Retire branch name |
| Daily-driver hardening | Merged pull requests and surviving beta code | Use beta behavior |
| Root and documentation tidy | Unique post-beta deletion commit | Continue as beta tree cleanup |

The prior daily-driver branch supplied decision records, vault references and Slack and Telegram features. The beta includes those changes. Its current handlers and tests are the starting point for project isolation and recovery. [Daily-driver merge to develop](https://github.com/gforge-esc/gwrk/pull/200) · [Beta release](https://github.com/gforge-esc/gwrk/pull/219)

The old stashes include workstation setup, early dispatch and generated artifacts. Current init owns workstation setup. Current dispatch owns execution through the agent plugin boundary. Apply neither old patch wholesale. Preserve the old objects in local archive refs. Revisit a specific acceptance case if current tests expose a gap.

## Implementation order

1. Review and land architecture context and assessment on develop. It includes the six proposed refactor features.
2. Review the daily-driver scope against the architecture branch. Retarget it to develop once onboarding lands.
3. Review beta tree cleanup against develop. Keep inputs that the runtime, gates and current docs use.
4. Start project identity and dispatch recovery from the reviewed beta code. Run the Google sign-in proof alongside those changes.
5. Define the next feature through gwrk with the assessment and research briefs as references. Verify gates before launching a guarded single-phase run.

The public branch uses a sanitized onboarding gap map. Original assessment artifacts and pre-cleanup edits are available in the local recovery refs.
