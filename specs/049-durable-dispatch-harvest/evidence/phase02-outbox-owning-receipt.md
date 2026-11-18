Gate failure notification claims validate the owning harvest and committed failed gate before changing delivery state. Blocked: independent review remains pending.

Three database-reopen cases failed before repair. They covered a missing gate receipt, a changed planned destination and a foreign feature identity. Each invalid claim changed the outbox row before repair.

The claim transaction now requires a matching project and feature owner. It requires a completed failed `gate_verify` receipt for the notice phase. It compares the notice recipient with the owner's saved recipient. First sends bind that destination. Reconciliation retains the saved destination and metadata key.

The phase 2 gate passes 127 tests. The regression log is `/tmp/gwrk-049-owning-gate-receipt-red.log`. The passing gate log is `/tmp/gwrk-049-owning-gate-receipt-green.log`.
