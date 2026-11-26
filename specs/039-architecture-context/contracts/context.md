# Context contract

Setup declares a target without assessing code. Blocked: none.

`project.design` records architecture and principles. Existing `project.architecture` retains legacy document and corpus paths. The derived context belongs in `.gwrk/architecture.md`. New decision templates remain Proposed. Managed files carry hashes in `.gwrk/context-manifest.json`.

`gwrk assess` requires initialized context. It produces a report and feature specs in a new output directory. Each finding needs source evidence. Every proposed feature names its finding coverage and dependencies. Invalid output fails the command.
