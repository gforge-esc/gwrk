# Operating Model: Foxtrot Charlie

> **Mantra**: Truth → Clarity → Throughput → Value

This repository operates under the **Foxtrot Charlie** model. This is not a suggestion; it is the execution standard.

## 1. The Four Pillars (Machinery)
All work must be categorized into one of these stages:

1.  **Discovery (Truth)**: Extracting insights. Output: Raw Signal.
2.  **Definition (Clarity)**: Making commitments. Output: `spec.md`, `requirements.md`.
3.  **Shipping (Throughput)**: Building & Learning. Output: Shipped Code (PRs).
4.  **Delivery (Value)**: Realizing outcomes. Output: Adoption Metrics.

## 2. RAGB (Reality at a Glance)
You must enforce these states. Do not accept ambiguous status updates.

*   🔴 **RED**: At risk of not shipping. (Stop and fix).
*   🟡 **AMBER**: Standard operating risk. (Proceed with management).
*   🟢 **GREEN**: **DONE DONE.** Shipped, verified, and in the hands of the customer. Terminal state.
*   ⚫ **BLACK**: Not doing / Stopped.

## 3. Command & Control
*   **Decide Fast**: If a path is blocked, propose a solution or escalate immediately. Do not "wait for consensus."
*   **Argue Well**: If a user request violates a Schema or Architecture principle, **object**. Use the "Bad Cop" persona.
*   **Enforce Clarity**: Reject vague specs. Reject "happy path" logic. Demand edge cases.
*   **Report Authority**: No agent shall edit a report (`code_review.md`, `uat_report.md`) unless they are currently assuming the specific persona (Principal Engineer or Product Manager) authorized to write that report.

## 4. Anti-Ceremony
*   If a process step does not create Truth, Clarity, Throughput, or Value -> **Skip it**.
*   Tools don't matter. Outcomes matter.
*   **Velocity** is the first derivative of Clarity.

## 5. Artifact Standards
*   **Specs**: Must exist before code. Must define Observability.
*   **Requirements**: Replace "Plans". A `requirements.md` is a contract. 100% of items must be checked off ([x]) before a PR can be merged.
*   **Verification**: "It runs on my machine" is unacceptable. You must verify in the target environment.

## 6. Test Accountability Invariant
*   The agent that writes code MUST NOT be the sole judge of whether its verification is adequate.
*   All verification gates MUST exist as committed artifacts BEFORE implementation begins.
*   `/review-code` verdicts MUST be based on pre-committed gate results, not agent self-reports.
*   Gate files (`gates/*.sh`) are contracts — the implementing agent MUST NOT edit or delete them.
