# Listing resolver compatibility

The dispatch repair includes the invocation directory in the policy roots for a registered workspace subdirectory. Enforcement listing now uses the same roots as dispatch. The worker reproduced both defects before repair and passed 264 Phase 4 tests with eight compiled CLI cases afterward.

Three existing listing cases mocked the entire profile detector module. Its new resolver therefore returned undefined. The repaired fixture supplies workspace roots through that mock and preserves all language and scope assertions. The targeted three cases and the complete 102-check Phase 3 gate pass. Phase 4 also passes again after the fixture repair.

Logs: `/tmp/gwrk-044-listing-mock-compatibility-green.log`, `/tmp/gwrk-044-listing-mock-phase3-green.log` and `/tmp/gwrk-044-listing-mock-phase4-green.log`. Earlier reviews remain in the retained history. Final review remains open.
