# Incomplete backup recovery hint

The restore command now names missing backup payloads and gives a recovery step. Independent review remains pending.

## Evidence

Two built CLI regressions failed on native Linux before the repair. One removed gwrk.db from a verified backup. The other removed repo-metadata.json. Both reported missing files without a recovery instruction.

After the repair, both native Linux cases passed. Each command exited 1 with one stderr signal and empty stdout. The target contained neither a ledger nor a restore marker. Source validation now tells the operator to recopy the complete backup directory or use another verified backup.

The reproduction used the pinned Node 22 Linux image and pnpm 9.15.9. Its log is /tmp/gwrk-050-incomplete-backup-native-red-green.log. The initial source came from bac1b7c5. The same container rebuilt the repaired adapter before rerunning the cases.

The full macOS phase 4 gate passed 230 checks and skipped six Linux-only cases. Its log is /tmp/gwrk-050-incomplete-backup-phase4-green.log. Combined native Linux verification remains required after integration.

The lint inventory script is reused unchanged from reviewed feature 046 commit 35c510de. It preserves tracked-file checks while excluding ignored runtime files.
