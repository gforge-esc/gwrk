# Pilot task gates

The pilot uses behavioral phase gates. Blocked: implementation remains open.

The generated T002 gate passed when the new auth policy and its test were absent. No task completed under that gate. The coordinator retained the original scripts before replacement.

Each task now delegates to its phase gate. Each gate rejects missing test targets before running the approved behavioral commands. The live acceptance gate also requires operator authority. That flag cannot replace live probes.

The focused initial run failed on the missing auth policy module, auth ports and proposed decision record. The 28 baseline architecture tests passed. The authored T002 gate also failed before implementation.

The independent Phase 1 test review returned GO. Its nonblocking barrel export observation remains recorded in phase1-red-review.md.

## Core follow-up

The task generator can emit a passing file-existence gate when feature tests do not exist. It can also treat other project tests as sufficient preparation. A separate core change needs a regression for this sequence and must reject incomplete behavioral coverage. This pilot replaces the generated gates. It does not fix the generator.

## Evidence

Private coordinator evidence lives in .runs/aws-hosted-pilot-nov23 under the main checkout. It includes the original scripts and authored gate manifest. The phase1-red.log and phase1-authored-gate-red.log files retain failing runs. The retained false-green reproduction and comparative gate regression remain named in the coordinator checkpoint.
