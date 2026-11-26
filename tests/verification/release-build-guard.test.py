# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("guard", Path(__file__).parents[2] / "scripts/release/build-preflight.py")


class BuildGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.addCleanup(self.tmp.cleanup)
        self.guard = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(self.guard)

    def test_low_space_stops_before_child_and_preserves_receipt(self):
        marker = self.root / "child"
        with self.assertRaisesRegex(RuntimeError, "space"):
            self.guard.supervise(self.root / "runs", self.root, self.root, ["touch", str(marker)],
                                  1, 1, 1, available=lambda p: 0)
        self.assertFalse(marker.exists())
        records = list((self.root / "runs").glob("*/owner.json"))
        self.assertEqual(len(records), 1)
        self.assertEqual(json.loads(records[0].read_text())["state"], "failed")

    def test_shared_filesystem_sums_workspace_cache_output_and_floor(self):
        needed = self.guard.requirements([(self.root, 3), (self.root, 5), (self.root, 7)], self.root)
        self.assertEqual(list(needed.values())[0][1], 15 + self.guard.ROOT_FLOOR)

    def test_child_inherits_busy_lease_and_payload_workspace(self):
        code = "import fcntl,os; f=open(os.environ['GWRK_BUILD_LEASE'],'a');\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: open(os.environ['GWRK_BUILD_WORKSPACE']+'/child','w').write('held')\n"
        self.assertEqual(self.guard.supervise(self.root / "runs", self.root, self.root,
                         ["python3", "-c", code], 1, 1, 1, available=lambda p: 100 * 1024**3), 0)
        record = next((self.root / "runs").glob("*/owner.json"))
        self.assertEqual(json.loads(record.read_text())["state"], "completed")
        self.assertTrue((record.parent / "payload/child").exists())

    def test_retention_preserves_unknown_and_durable_receipts(self):
        runs = self.root / "runs"
        runs.mkdir()
        unknown = runs / "foreign"
        unknown.mkdir()
        (unknown / "sentinel").write_text("keep")
        for number in range(4):
            run_id = f"{number:024x}"
            run = runs / run_id
            run.mkdir()
            (run / "payload").mkdir()
            (run / "payload/source").write_text("heavy")
            (run / "proof.json").write_text("keep")
            (run / "owner.json").write_text(json.dumps(dict(schema=1, kind="gwrk-release-build", runId=run_id, state="completed", completedAt=str(number))))
        self.guard.retain(runs)
        self.assertFalse((runs / f"{0:024x}" / "payload").exists())
        self.assertTrue((runs / f"{0:024x}" / "proof.json").exists())
        self.assertTrue((runs / f"{3:024x}" / "payload/source").exists())
        self.assertTrue((unknown / "sentinel").exists())

    def test_output_inside_disposable_root_fails_before_retention(self):
        runs = self.root / "runs"
        runs.mkdir()
        output = runs / "output"
        output.mkdir()
        with self.assertRaisesRegex(RuntimeError, "outside"):
            self.guard.supervise(runs, self.root, output, ["false"], 1, 1, 1)

    def test_busy_run_survives_abandoned_build_recovery(self):
        runs = self.root / "runs"
        runs.mkdir()
        run = runs / ("a" * 24)
        run.mkdir()
        (run / "payload").mkdir()
        record = dict(schema=1, kind="gwrk-release-build", runId=run.name, state="building")
        self.guard.write_owner(run, record)
        lease = self.guard.lock(run / ".lease")
        try:
            self.guard.retain(runs)
            self.assertEqual(json.loads((run / "owner.json").read_text())["state"], "building")
        finally:
            os.close(lease)
        self.guard.retain(runs)
        self.assertEqual(json.loads((run / "owner.json").read_text())["state"], "failed")

    def test_worker_accepts_only_live_supervisor_session(self):
        script = Path(SPEC.origin)
        self.assertEqual(self.guard.supervise(self.root / "runs", self.root, self.root,
                         ["python3", str(script), "--assert-guard"], 1, 1, 1,
                         available=lambda p: 100 * 1024**3), 0)

    def test_unlocked_matching_descriptor_cannot_authenticate_worker(self):
        runs = self.root / "runs"
        run = runs / ("a" * 24)
        workspace = run / "payload"
        workspace.mkdir(parents=True)
        self.guard.write_owner(run, dict(schema=1, kind="gwrk-release-build", runId=run.name, state="building"))
        (run / "preflight.json").write_text(json.dumps([dict(requiredBytes=8 * 1024**3, availableBytes=20 * 1024**3)]))
        lease = os.open(run / ".lease", os.O_RDWR | os.O_CREAT, 0o600)
        held = self.guard.lock(runs / ".retention.lock")
        try:
            with patch.dict(os.environ, GWRK_BUILD_WORKSPACE=str(workspace), GWRK_BUILD_LEASE_FD=str(lease), GWRK_BUILD_LOCK_FD=str(held)):
                with self.assertRaisesRegex(RuntimeError, "not held"):
                    self.guard.assert_guard()
        finally:
            os.close(lease)
            os.close(held)

    def test_borrowed_descriptor_does_not_authenticate_another_supervisors_lock(self):
        runs = self.root / "runs"
        run = runs / ("b" * 24)
        workspace = run / "payload"
        workspace.mkdir(parents=True)
        self.guard.write_owner(run, dict(schema=1, kind="gwrk-release-build", runId=run.name, state="building"))
        (run / "preflight.json").write_text(json.dumps([dict(requiredBytes=8 * 1024**3, availableBytes=20 * 1024**3)]))
        held_lease = self.guard.lock(run / ".lease")
        borrowed = os.open(run / ".lease", os.O_RDWR)
        held_global = self.guard.lock(runs / ".retention.lock")
        try:
            with patch.dict(os.environ, GWRK_BUILD_WORKSPACE=str(workspace), GWRK_BUILD_LEASE_FD=str(borrowed), GWRK_BUILD_LOCK_FD=str(held_global)):
                with self.assertRaisesRegex(RuntimeError, "does not own"):
                    self.guard.assert_guard()
        finally:
            for fd in (borrowed, held_lease, held_global):
                os.close(fd)


if __name__ == "__main__":
    unittest.main()
