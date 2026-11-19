CLI launch actions retain claimed receipts until the child confirms spawn. Asynchronous launch errors produce failed receipts and one private threaded reply. Blocked: independent review remains pending.

Three regressions covered spec approval and both revision buttons. Each recorded executed and posted public success before the child confirmed launch. The tests now hold the spawn event and assert that the receipt remains claimed. They then emit an error and verify one failed outcome with no public success.

A shared launcher observes spawn and error before returning. Successful launches remain detached in the verified checkout. Spec approval invokes `gwrk define plan`.

The phase gate passes 190 tests. The failing evidence is `/tmp/gwrk-048-asynchronous-launch-receipt-red.log`. The passing evidence is `/tmp/gwrk-048-asynchronous-launch-receipt-final-green.log`.
