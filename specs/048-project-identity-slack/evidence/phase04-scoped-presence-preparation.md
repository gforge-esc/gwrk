# Scoped presence preparation

The notification adapter queries the requested user in the accepted Slack workspace. It verifies the workspace before reading presence and returns only the active or away states allowed by NotificationPort. The lookup rejects missing clients and API errors. It also rejects unknown states and workspace mismatches. This path does not enumerate workspace users.

Eight behavioral cases failed before implementation and passed after it. The logs are `/tmp/gwrk-048-scoped-presence-adapter-red.log` and `/tmp/gwrk-048-scoped-presence-all-cases-green.log`. The full eight-case run replaces an earlier filtered run that omitted one case.

Phase 4 remains open. Four project delivery cases still fail in `/tmp/gwrk-048-delivery-still-open-after-presence.log`: the delivery adapter still needs accepted workspace and project bindings. Accepted channel and thread bindings also need repair. The existing presence manager also needs routing by project and user. This preparation does not establish delivery review clearance or live Slack enrollment.
