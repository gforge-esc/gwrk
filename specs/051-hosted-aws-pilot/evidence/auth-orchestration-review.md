# Authentication orchestration review

GO for independent application preparation `7b485e7c1e8e8771ae0e588140439adb4212386a`. Blocked: none in the reviewed scope. Phase 2 storage composition and full Phase 3 clearance remain outstanding.

Review covers only request authentication and browser session orchestration plus their tests and application exports. It does not reassess the Google adapter. No tests reran.

API authentication selects credentials before calling ports. It rejects missing records and mismatched verifiers. Lifecycle policy enforces audience and expiry plus revocation and overlap deadlines. Store and crypto exceptions produce safe denials. Invalid API credentials cannot fall back to Google sessions.

Google verification failures create no session observation. The application reads time and checks expiry again after verification. Atomic observation owns the immutable cap and revocation marker. Revoked or conflicting observations deny authentication. The returned context contains the digest and identity without raw token or email.

Browser reads require matching identity and digest plus a current session. Logout commits revocation before the proxy await. Failed revocation prevents proxy calls. Proxy failure preserves origin revocation and returns an explicit incomplete-clearing result. The controlled concurrent test proves observation cannot revive a session revoked during pending verification.

The application introduces no project role authority. Public and webhook routes return explicit null contexts. Their future HTTP adapters retain route and HMAC enforcement responsibilities.

The 41 application cases and recorded 126 related passing cases support this preparation boundary. The initial RED accurately records a missing implementation module. Manifest hashes match the candidate and recorded logs. Fake ports establish application ordering without claiming SQLite or HTTP acceptance.

Nonblocking integration note: the future logout HTTP adapter must map `proxyCleared: false` to the specified gateway failure response. It must clear the CSRF cookie while retaining origin revocation. This explicit application result supports that mapping.

Only private review evidence changed. No production source or external state changed.
