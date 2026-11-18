Gate failure claims preserve any existing destination. They bind the planned recipient only when every saved route field is null. Blocked: independent review remains pending.

Three restart regressions failed before repair. They covered a foreign workspace and channel, a conflicting thread and a partially bound destination. The claim overwrote the saved route in each case. A matching bound pending route remains claimable.

The claim and stage transition now share one destination predicate. Both require an unbound pending row or an exact match to the saved planned recipient. Rejection preserves the entire SQLite row. The canonical notice key and metadata identity remain unchanged.

The phase gate passes 134 tests. The failing log is `/tmp/gwrk-049-conflicting-pending-route-red.log`. The passing log is `/tmp/gwrk-049-conflicting-pending-route-green.log`.
