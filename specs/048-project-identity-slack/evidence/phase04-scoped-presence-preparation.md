# Scoped presence preparation

The notification adapter queries the requested user in the accepted Slack workspace. It verifies the workspace before reading presence and returns only the active or away states allowed by NotificationPort. Missing clients, API errors, unknown states and workspace mismatches reject the lookup. This path does not enumerate workspace users.

Eight behavioral cases failed before implementation and passed after it. The logs are `/tmp/gwrk-048-scoped-presence-adapter-red.log` and `/tmp/gwrk-048-scoped-presence-all-cases-green.log`. The earlier filtered run omitted one case and is superseded by the full eight-case run.

Phase 4 remains open. Four project delivery cases still fail in `/tmp/gwrk-048-delivery-still-open-after-presence.log`: accepted workspace, project, channel and thread bindings still need the delivery adapter repair. The existing presence manager also needs routing by project and user. This preparation does not establish delivery review clearance or live Slack enrollment.
