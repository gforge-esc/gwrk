The preflight fixture now passes on both the host and native Node 20 Linux. Production still requires Node 22. Independent review of the verification repair remains pending.

Final-head CI run `44420976322` failed its Node 20 job at `1cfd0064`. Node 22 passed. The fixture used the host executable for its simulated runner. Preflight correctly rejected Node 20 before Git and worker checks. The fixture expected those later checks to run.

The fixture now supplies its simulated runtime version through an isolated preload. It checks rejection of Node 18 and Node 20 before credentials or the worker. Accepted runtime cases still exercise authentication, backend availability and credential probing. The stub helper unlinks its fixture alias before creating an exclusive executable file.

RED evidence is `/tmp/gwrk-050-host-independent-runtime-fixture-red.log`. One case failed and six passed. Host GREEN evidence is `/tmp/gwrk-050-host-independent-runtime-fixture-green.log`. Native Node 20 Linux GREEN evidence is `/tmp/gwrk-050-preflight-native-node20-green.log`. Both record seven passing checks. The phase gate passes 13 checks in `/tmp/gwrk-050-runtime-fixture-phase5-green.log`.

Initial stub attempts tried to replace the fixture's executable symlink. The operating system denied both writes. Those failures remain in `/tmp/gwrk-050-runtime-fixture-initial-stub-failure.log` and `/tmp/gwrk-050-preflight-native-node20-initial-stub-failure.log`. The repaired helper replaces only the fixture alias.

The installed-release proof and production code remain unchanged. Review and CI evidence from the prior head remain in `.gwrk/review-history/phase-05-through-2026-11-18T2340Z.json`.
