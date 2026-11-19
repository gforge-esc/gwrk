# Slack and durable migration composition

The first full combined run passed 3,772 tests and failed one migration inventory assertion. The database applied both migration 018 files. The assertion listed only the durable migration and omitted the Slack receipt target migration.

The regression now starts with an execution run and an uncertain Slack merge receipt in the preceding schema. It verifies both records after upgrade. The receipt keeps its project and actor binding. Its outcome stays uncertain and its new merge target columns remain null. Both migration names must appear in the ordered ledger. Foreign key checks remain clean.

The strengthened case reproduced the assertion failure before the expected inventory was corrected. The complete migration and scoping run passes 157 tests. No migration or stored record changed for this repair.

The failed full run is `/tmp/gwrk-integration-slack3-full-ci.log`. The strengthened RED and GREEN logs are `/tmp/gwrk-integration-slack3-migrations-red.log` and `/tmp/gwrk-integration-slack3-migrations-green.log`. Full combined verification remains pending after this correction.
