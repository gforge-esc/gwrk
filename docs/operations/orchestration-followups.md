These orchestration improvements remain separate from core acceptance. Current controls preserve evidence and bound work without changing the agreed feature scope.

| Followup | Observed behavior | Current control |
|---|---|---|
| Pass test failures into diagnosis | Test-stage failure can reach diagnosis without failureContext | Diagnose from the gate log and add a failing behavioral regression before repair |
| Store shared diagnostics once | Repeated gate output expands every affected task description | Archive complete task state under review-history and reference it from active instructions |
| Forward task authorization | A worker refused an obsolete test update authorized by the user | Forward the current authorization for regression repairs and preserve the plan entry |
| Share phase gate execution | Tasks sharing one gate repeat the same heavy checks | Limit heavy checks independently from inference slots |

Archives preserve prior findings and repairs. They do not clear a review finding. A phase still requires passing gates and independent review.
