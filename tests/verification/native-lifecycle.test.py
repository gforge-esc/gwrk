# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).parents[2]


class NativeLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        spec = importlib.util.spec_from_file_location("driver", SOURCE / "deploy/verification/stage-native-proof.py")
        self.d = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.d)

    def test_foreign_data_directory_survives_stage_heavy(self):
        run = self.root / "run"
        run.mkdir()
        data = self.root / "data"
        data.mkdir()
        run_id = "a" * 24
        foreign = data / run_id
        foreign.mkdir()
        sentinel = foreign / "foreign-ledger"
        sentinel.write_text("keep")
        archive = self.root / "source.tar"
        with tarfile.open(archive, "w"):
            pass
        cfg = types.SimpleNamespace(require_root=False, data_root=data, uid=os.getuid(), gid=os.getgid())
        args = types.SimpleNamespace(run_id=run_id, source_commit="b" * 40,
                                     runtime_manifest_sha256="c" * 64, source_sha256=self.d.sha256_file(archive))
        with patch.object(self.d, "run_cmd", side_effect=RuntimeError("stop external commands")):
            with self.assertRaises(Exception):
                self.d.stage_heavy(cfg, args, run, None, None, archive)
        self.assertTrue(sentinel.exists(), "staging deleted an unowned data directory")

    def test_command_timeout_stops_descendant_writes(self):
        marker = self.root / "orphan-sentinel"
        grandchild = f"import time,pathlib;time.sleep(.4);pathlib.Path({str(marker)!r}).write_text('survived')"
        child = f"import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',{grandchild!r}],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(20)"
        with self.assertRaises(subprocess.TimeoutExpired):
            self.d.run_cmd([sys.executable, "-c", child], timeout=.1)
        time.sleep(.6)
        self.assertFalse(marker.exists(), "descendant wrote after command timeout")

    def test_stage_serializes_heavy_work_under_retention_lock(self):
        runs = self.root / "runs"
        runs.mkdir()
        source = self.root / "stub-source"
        source.write_text("stub")
        cfg = types.SimpleNamespace(runs=runs, data_parent=self.root, data_root=self.root / "fixtures",
                                    require_root=False, data_parent_owner=None, uid=os.getuid(), gid=os.getgid(),
                                    node="stub", early_build=1, early_data=1, root_path="/", host_identity=None)
        args = types.SimpleNamespace(run_id="d" * 24, source_commit="e" * 40,
                                     runtime_manifest_sha256="f" * 64, purpose="acceptance",
                                     source_archive=str(source), lifecycle_archive=str(source),
                                     source_sha256="1" * 64, lifecycle_sha256="2" * 64)

        def heavy(*_args):
            with (runs / ".retention.lock").open("a") as handle:
                with self.assertRaises(BlockingIOError, msg="heavy work released the shared disk reservation lock"):
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return {}

        with patch.object(self.d, "verify_digest"), patch.object(self.d, "verify_driver"), \
             patch.object(self.d, "extract_bootstrap", return_value=self.root / "bootstrap"), \
             patch.object(self.d, "run_cmd", return_value=types.SimpleNamespace(returncode=0)), \
             patch.object(self.d, "stage_heavy", side_effect=heavy):
            self.assertEqual(self.d.stage(args, cfg), 0)

    def test_public_build_switch_cannot_bypass_guard_with_regular_descriptor(self):
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        log = self.root / "git-log"
        fake = bin_dir / "git"
        fake.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$REPRO_LOG"\nif [ "$1" = rev-parse ]; then printf "%040d\\n" 1; else exit 9; fi\n')
        fake.chmod(0o700)
        shim = self.root / "linux.cjs"
        shim.write_text("Object.defineProperty(process, 'platform', {value:'linux'});\n")
        workspace = self.root / "workspace"
        workspace.mkdir()
        with (self.root / "unlocked").open("w") as handle:
            env = dict(os.environ, PATH=str(bin_dir) + ":" + os.environ["PATH"], REPRO_LOG=str(log),
                       GWRK_BUILD_WORKSPACE=str(workspace), GWRK_BUILD_LEASE_FD=str(handle.fileno()),
                       GWRK_BUILD_CACHE=str(self.root))
            result = subprocess.run(["node", "--require", str(shim), str(SOURCE / "scripts/release/build-linux-release.mjs"),
                                     "--guarded-build", str(self.root / "output")], env=env,
                                    pass_fds=(handle.fileno(),), capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(log.exists(), "public bypass invoked Git before preflight")

    def proof_fixture(self, command):
        runs = self.root / "runs"
        runs.mkdir()
        run_id = "a" * 24
        run = runs / run_id
        run.mkdir()
        data = self.root / "data"
        data.mkdir()
        self.d.write_owner(run, dict(schema=1, runId=run_id, state="staged", sourceCommit="b" * 40,
                                    runtimeManifestSha256="c" * 64, heavy=[], images=[]))
        (run / "storage-checkpoint.json").write_text(json.dumps(dict(runId=run_id, sourceCommit="b" * 40,
            runtimeManifestSha256="c" * 64, estimatedDataBytes=1024**3)))
        cfg = types.SimpleNamespace(runs=runs, data_root=data, root_path="/", data_budget=12 * 1024**3)
        args = types.SimpleNamespace(run_id=run_id, command=command)
        return cfg, args

    def test_low_space_proof_never_starts_child(self):
        marker = self.root / "proof-child"
        cfg, args = self.proof_fixture([sys.executable, "-c", f"open({str(marker)!r},'w').write('started')"])
        with patch.object(self.d.os, "statvfs", return_value=types.SimpleNamespace(f_bavail=0, f_frsize=1)):
            with self.assertRaisesRegex(Exception, "space|GiB"):
                self.d.execute(args, cfg)
        self.assertFalse(marker.exists())

    def test_proof_excludes_staging_with_shared_lock(self):
        marker = self.root / "proof-lock"
        cfg, args = self.proof_fixture([])
        probe = "import fcntl,sys; f=open(sys.argv[1],'a');\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); state='free'\nexcept BlockingIOError: state='busy'\nopen(sys.argv[2],'w').write(state)"
        args.command = [sys.executable, "-c", probe, str(cfg.runs / ".retention.lock"), str(marker)]
        with patch.object(self.d.os, "statvfs", return_value=types.SimpleNamespace(f_bavail=100 * 1024**3, f_frsize=1)):
            self.assertEqual(self.d.execute(args, cfg), 0)
        self.assertEqual(marker.read_text(), "busy")

    def test_shared_filesystem_adds_estimate_to_root_floor(self):
        cfg, args = self.proof_fixture(["false"])
        cfg.root_path = str(self.root)
        run = cfg.runs / args.run_id
        with patch.object(self.d.os, "statvfs", return_value=types.SimpleNamespace(f_bavail=5 * 1024**3, f_frsize=1)):
            with self.assertRaisesRegex(Exception, "shared filesystem"):
                self.d.proof_disk_preflight(cfg, run, self.d.read_owner(run, args.run_id))

    def test_proof_rejects_changed_source_checkpoint_before_child(self):
        marker = self.root / "proof-child"
        cfg, args = self.proof_fixture([sys.executable, "-c", f"open({str(marker)!r},'w').write('started')"])
        path = cfg.runs / args.run_id / "storage-checkpoint.json"
        record = json.loads(path.read_text())
        record["sourceCommit"] = "d" * 40
        path.write_text(json.dumps(record))
        with self.assertRaisesRegex(Exception, "source identity"):
            self.d.execute(args, cfg)
        self.assertFalse(marker.exists())

    def failed_proof_fixture(self):
        marker = self.root / "retry-child"
        cfg, args = self.proof_fixture([sys.executable, "-c", f"open({str(marker)!r},'w').write('started')"])
        run = cfg.runs / args.run_id
        self.d.update_owner(run, args.run_id, state="failed", completedAt="2026-11-26T16:00:00Z", exitCode=7, error="prior proof failed")
        return cfg, args, marker

    def test_failed_proof_requires_explicit_retry_flag(self):
        cfg, args, marker = self.failed_proof_fixture()
        with self.assertRaisesRegex(Exception, "failed"):
            self.d.execute(args, cfg)
        self.assertFalse(marker.exists())
        self.assertEqual(self.d.read_owner(cfg.runs / args.run_id, args.run_id)["exitCode"], 7)

    def test_explicit_failed_retry_preserves_attempt_before_running_under_both_locks(self):
        cfg, args, marker = self.failed_proof_fixture()
        run = cfg.runs / args.run_id
        code = "import fcntl,json,pathlib,sys; run=pathlib.Path(sys.argv[1]); receipts=list((run/'proof-attempts').glob('*.json')); assert len(receipts)==1; prior=json.loads(receipts[0].read_text())['owner']; assert prior['state']=='failed' and prior['exitCode']==7 and prior['error']=='prior proof failed'; current=json.loads((run/'gwrk-run-owner.json').read_text()); assert current['state']=='executing' and 'completedAt' not in current and 'exitCode' not in current and 'error' not in current\nfor path in (run/'.lease',run.parent/'.retention.lock'):\n f=open(path,'a')\n try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); raise AssertionError('lock free')\n except BlockingIOError: pass\npathlib.Path(sys.argv[2]).write_text('started')"
        args = self.d.parse(["exec", "--config", "unused", "--run-id", args.run_id, "--retry-failed", "--",
                             sys.executable, "-c", code, str(run), str(marker)])
        with patch.object(self.d.os, "statvfs", return_value=types.SimpleNamespace(f_bavail=100 * 1024**3, f_frsize=1)):
            self.assertEqual(self.d.execute(args, cfg), 0)
        self.assertTrue(marker.exists())
        self.assertEqual(self.d.read_owner(run, args.run_id)["state"], "completed")

    def test_failed_retry_with_changed_checkpoint_never_starts_child(self):
        cfg, args, marker = self.failed_proof_fixture()
        args.retry_failed = True
        checkpoint = cfg.runs / args.run_id / "storage-checkpoint.json"
        record = json.loads(checkpoint.read_text())
        record["sourceCommit"] = "d" * 40
        checkpoint.write_text(json.dumps(record))
        with self.assertRaisesRegex(Exception, "source identity"):
            self.d.execute(args, cfg)
        self.assertFalse(marker.exists())

    def test_failed_retry_with_low_space_never_starts_child(self):
        cfg, args, marker = self.failed_proof_fixture()
        args.retry_failed = True
        with patch.object(self.d.os, "statvfs", return_value=types.SimpleNamespace(f_bavail=0, f_frsize=1)):
            with self.assertRaisesRegex(Exception, "space|GiB"):
                self.d.execute(args, cfg)
        self.assertFalse(marker.exists())
        self.assertEqual(self.d.read_owner(cfg.runs / args.run_id, args.run_id)["exitCode"], 7)

    def test_retry_flag_cannot_reexecute_completed_run(self):
        cfg, args, marker = self.failed_proof_fixture()
        args.retry_failed = True
        self.d.update_owner(cfg.runs / args.run_id, args.run_id, state="completed")
        with self.assertRaisesRegex(Exception, "completed"):
            self.d.execute(args, cfg)
        self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
