# Hosted Google sign-in validation

The production configuration passed offline tests and an isolated container test. Blocked for live acceptance until the pilot host, public DNS and Google web client are available.

| Check | Target | Result |
|---|---|---|
| Offline tests | Reject unsafe configuration and inputs | Pass |
| Allowed login | Fixed status response through Traefik and OAuth2 Proxy | Pass |
| Denial | Deny unlisted and unverified users, wrong audience, tampered state and forged headers | Pass |
| Status origin | Deny direct access from the test issuer network | Pass |
| Browser session | Deny access after sign-out and cookie expiry | Pass |
| Allowlist revocation | Deny the existing session within eight seconds of proxy restart | Pass |
| Public Google sign-in | Browser returns from Google to the pilot host over trusted TLS | Pending |

The first gateway test used malformed state and hit the provider's parse error. The passing test uses well-formed tampered state. Atomic allowlist replacement did not revoke a session within five seconds in the fixture. The passing gate restarts OAuth2 Proxy after replacing the file.
