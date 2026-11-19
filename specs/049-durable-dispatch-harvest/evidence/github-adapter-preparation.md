# GitHub adapter preparation

The GitHub harvest adapter implements the approved GitHubHarvestPort. Phase 3 remains open until Git and notification adapters pass their gates and independent review.

## Contract

The adapter validates webhook signatures against the original bytes with HMAC SHA-256 and constant-time comparison. Empty secrets and malformed signatures fail closed.

Pull request collection preserves the base repository and the head repository as separate identities. It collects closed records across pages and applies an inclusive terminal timestamp cursor. Foreign metadata and malformed responses fail closed. Lookup errors propagate to the caller.

The transport uses argument arrays and an explicit checkout directory. Tests inject the transport without network calls. Production calls have a twelve-second timeout. Pagination has a bounded page limit and fails rather than returning truncated results.

## Verification

The initial adapter suite failed because the implementation was absent. After implementation, all six behavioral checks passed. Build and targeted Biome checks passed. The logs are /tmp/gwrk-049-github-adapter-red.log and /tmp/gwrk-049-github-adapter-green.log.

The checks cover raw-body authentication and pagination. They also cover head repository identity and closed-unmerged records. Terminal timestamp boundaries and lookup failures have separate cases. They include rejection of foreign base metadata.

## References

[GitHub pull request API](https://docs.github.com/en/rest/pulls/pulls) defines pagination and terminal record fields. [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) defines the signature contract.
