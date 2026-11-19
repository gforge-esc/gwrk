Policy-lock reader preparation passes 43 checks. Dispatch integration remains open. Independent phase clearance remains required.

The reader validates the strict version 1 schema and unique skill names. Absence preserves legacy opt-in behavior without writes. A dangling lock link fails as unreadable. The digest sorts object keys recursively and preserves array order. It normalizes text line endings to LF. Candidate verification retains only pins from the declared layer. It rejects disabled or changed pins and a gwrk version mismatch.

The contract-first reader suite initially failed 15 cases before implementation. A later dangling-link case failed before its repair. The final suite passes 17 reader cases and 26 architecture checks. Build passes.

Dispatch wiring must preserve the original parsed manifest separately from computed enablement metadata. Supply that manifest to digest verification. Compose policy from the verified candidate content without rereading it. Keep legacy behavior when the lock is absent. The dispatch regression file remains required by the phase gate and is still missing. This preparation does not clear phase 3.

Verification logs remain in the private checksum archive. Their source names are `/tmp/gwrk-045-policy-lock-reader-red.log`, `/tmp/gwrk-045-policy-lock-dangling-link-red.log` and `/tmp/gwrk-045-policy-lock-reader-final-green.log`.
