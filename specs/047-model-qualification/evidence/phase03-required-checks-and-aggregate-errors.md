Qualification rejects empty required gate evidence before judging. It scans error causes and aggregate members before returning a judge transport error. Blocked: independent review remains pending.

Two implementation regressions supplied a passing aggregate with no checks. One covered the candidate and one covered the incumbent. Both incorrectly qualified before repair. The required gate set now requires at least one check and no failed check.

A third regression placed a known environment credential inside an AggregateError member. The error escaped the earlier cause-only scan. The scanner now visits both cause and aggregate edges. It tracks visited errors and preserves clean transport diagnostics.

The phase gate passes 677 checks. Its prerequisite gate passes 543 checks. Lint passes. The failing log is `/tmp/gwrk-047-empty-checks-aggregate-error-red.log`. The passing log is `/tmp/gwrk-047-empty-checks-aggregate-error-green.log`.
