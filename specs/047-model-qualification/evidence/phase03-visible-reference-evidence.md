# Visible reference evidence

Definition qualification previously counted required citations and source paths inside HTML comments. Those strings do not establish that a usable specification or plan carries the required references.

TR-033 reproduces both cases with the retained reviewer patch. The initial run failed both cases. Reference checks now remove complete and unclosed HTML comments before matching. The complete Phase 3 gate passes 699 tests and the prerequisite gate. The tracked-source linter passes 354 files.

Logs: `/tmp/gwrk-047-comment-citations-red.log` and `/tmp/gwrk-047-comment-citations-phase-green.log`. Prior verdicts remain in the review history. The phase remains open for independent review.
