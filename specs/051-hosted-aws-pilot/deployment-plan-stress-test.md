# Hosted pilot plan assessment

APPROVE for private preparation. The plan keeps application exposure behind authentication acceptance and includes rollback for every external step. Blocked: production authentication and live credentials. The coordinator owns both dependencies.

## Dependencies

| Phase | Depends on | Blast radius | Rollback |
|---|---|---|---|
| Authentication | Approved core ports | Low | Remove unexposed release |
| Private host | Verified account and cost | Low | Stop instance and retain data |
| Private installation | Authentication and host | Medium | Stop service and restore release |
| Restricted acceptance | Installation and Google setup | Medium | Close restricted HTTPS ingress |
| Public gateway | Every acceptance gate | High | Close ingress and remove DNS |

The critical path has four phases. Authentication and private host preparation run independently before installation. Google setup can precede installation once callback and account scope are fixed.

## Failure scenarios

| Root cause | Phase | Prevention | Early signal |
|---|---|---|---|
| Header forgery bypass | Authentication | Verify credentials at trusted boundary | Synthetic forged-header denial |
| Gateway exposes origin | Public gateway | Loopback bind and dedicated ingress gate | Direct-origin probe |
| Laptop credentials fail unattended | Installation | Actual bounded host credential probes | Failed private preflight |
| Restart loses accepted work | Restricted acceptance | Persistent volume and recovery test | Duplicate effect or missing receipt |
| Incorrect cloud account | Private host | Explicit profile and identity check | Account mismatch before mutation |

## Alternatives

| Alternative | Critical path | Top blast radius | Comparison |
|---|---|---|---|
| Simplest combined deploy | Three phases | High | Loses independent exposure barrier |
| Most parallel preparation | Four phases | High | Already used for host and auth |
| Most conservative private pilot | Four phases | High | Already uses restricted acceptance |

## Assumptions

The user authorized AWS deployment and security setup. Prices come from the current AWS public list. Provider credentials remain unverified on the future host. No application port will be public before live security checks. This assessment does not claim the read-only Google proof secures the full service.
