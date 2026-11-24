Both code review workflows use the host project's verification commands and Principal Engineer reporting rules. Their source and built prompts remain identical. Blocked: independent review remains pending.

The CLI-only persona repair broke two existing prompt parity checks. Additional captured web review cases failed for host guidance. Both workflows now include the same persona and condition their native commands against the selected profile. Unknown profiles receive host guidance.

The phase gate requires the existing prompt contract suite. It passes 194 checks. The full suite passes 2,241 tests.

Evidence logs:

- `/tmp/gwrk-045-review-prompt-parity-red.log`
- `/tmp/gwrk-045-review-prompt-parity-green.log`
- `/tmp/gwrk-045-review-prompt-parity-full-ci.log`
