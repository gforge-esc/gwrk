Two custom-workflow scope regressions fail before repair and pass afterward. The phase gate passes 252 checks and eight compiled CLI acceptance checks. The full suite passes 2227 tests. Independent review remains pending.

Pure domain policy resolves built-in workflow bindings first. Custom workflows honor explicit definition, implementation or review task scope. Name inference follows those explicit choices. The shared dispatch path uses this policy.

The retained cases prove that preview names do not select review policy for definition tasks. They prove that a custom plan-like name does not select definition policy for an implementation task. Built-in definition, implementation and review controls remain covered.

RED evidence is `/tmp/gwrk-044-custom-workflow-scope-red.log`. Two cases failed and 22 passed. GREEN evidence is `/tmp/gwrk-044-custom-workflow-scope-green.log`. Full-suite evidence is `/tmp/gwrk-044-custom-workflow-scope-full-ci.log`.

The phase gate includes the existing domain policy tests alongside actual dispatch capture. Prior review and diagnosis remain in `.gwrk/review-history/phase-04-through-2026-11-18T2341Z.json`.
