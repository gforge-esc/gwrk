# Internal proxy logout boundary review

GO to freeze the internal logout interface. Blocked: none in this design scope. The coordinator retains live operations authority.

The fixed loopback endpoint preserves the approved private origin boundary. Request and project configuration cannot redirect logout. The adapter forwards Cookie without identity or redirect headers. Origin revocation remains a prerequisite. Timeouts and static failures retain the existing port.

The pinned OAuth2 Proxy 7.15.6 SignOut handler clears session cookies and normally responds with HTTP 302. The adapter must accept the clearing response without following its redirect. It must omit Location from its own result. Cookie-store Clear emits separate headers for the configured cookie and numbered chunks supplied in the request. Forwarding the original Cookie header supports chunk clearing. [Pinned SignOut source](https://github.com/oauth2-proxy/oauth2-proxy/blob/v7.15.6/oauthproxy.go#L707). [Pinned cookie store](https://github.com/oauth2-proxy/oauth2-proxy/blob/v7.15.6/pkg/sessions/cookie/session_store.go#L65).

The production `__Host-gwrk_session` name must reach credential selection consistently. The proof bundle keeps its existing name. No port change or account choice follows from this section.

Nonblocking adapter detail: include the normal 302 clearing response as a positive fixture. A blanket non-2xx rejection would obstruct valid proxy logout. Preserve headers separately using getSetCookie rather than splitting comma-joined values.

This review checks design and pinned source behavior. No proxy request or test ran. No host or browser setting changed.
