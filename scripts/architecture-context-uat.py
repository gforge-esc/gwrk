#!/usr/bin/env python3
"""Exercise the compiled CLI without calling an agent or changing user settings."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
node = shutil.which("node")
cli = repo / "dist/cli.js"
checks = []
with tempfile.TemporaryDirectory(prefix="gwrk-context-uat-") as temporary:
    base = Path(temporary)
    binaries = base / "bin"
    binaries.mkdir()
    marker = base / "agent-called"
    for name in ("agy", "claude", "codex"):
        executable = binaries / name
        executable.write_text(f"#!/bin/sh\ntouch '{marker}'\nexit 99\n")
        executable.chmod(0o755)
    env = dict(os.environ, GWRK_HOME=str(base / "home"), PATH=f"{binaries}:/usr/bin:/bin", GWRK_AGENT="0")

    def run(root, *arguments):
        result = subprocess.run([node, str(cli), *arguments], cwd=root, env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stdout + result.stderr
        return result

    fresh = base / "fresh"
    fresh.mkdir()
    (fresh / "package.json").write_text('{"name":"fresh","type":"module"}')
    run(fresh, "init", "--remote", "--non-interactive", "--architecture", "hexagonal-functional", "--language", "Python", "--framework", "FastAPI")
    target = (fresh / ".gwrk/architecture.md").read_text()
    assert "unassessed" in target and "FastAPI" in target and "typing.Protocol" in target
    checks.append("Fresh project full init composes the selected context without an agent call")
    first = {str(file.relative_to(fresh)): hashlib.sha256(file.read_bytes()).hexdigest() for file in (fresh / ".gwrk").rglob("*") if file.is_file()}
    run(fresh, "init", "--remote", "--non-interactive")
    second = {str(file.relative_to(fresh)): hashlib.sha256(file.read_bytes()).hexdigest() for file in (fresh / ".gwrk").rglob("*") if file.is_file()}
    assert first == second
    checks.append("Re-init produces identical context and no duplicate decisions")
    run(fresh, "assess", "--print")
    assert not marker.exists(), "An agent executable ran during setup or print"
    checks.append("Assessment preview makes zero agent calls")

    existing = base / "existing"
    existing.mkdir()
    (existing / ".gwrkrc.json").write_text(json.dumps({"project": {"name": "existing", "architecture": {"doc": "design.md", "decisions": "docs/adr"}}}))
    (existing / "AGENTS.md").write_text("Keep this instruction.\n")
    (existing / "source.py").write_text("print('existing behavior')\n")
    personal = '{"agents":{"define":"personal-backend"}}'
    (existing / ".gwrkrc.local.json").write_text(personal)
    run(existing, "init", "--context-only", "--architecture", "hexagonal-functional", "--language", "Python")
    assert (existing / ".gwrkrc.local.json").read_text() == personal
    assert (existing / "source.py").read_text() == "print('existing behavior')\n"
    assert "Keep this instruction." in (existing / "AGENTS.md").read_text()
    assert len(list((existing / "docs/adr").glob("ADR-*.md"))) == 1
    checks.append("Existing project preserves source and personal settings with a custom decision corpus")
    with (existing / ".gwrk/architecture.md").open("a") as file:
        file.write("\nHuman exception.\n")
    result = run(existing, "init", "--context-only")
    assert json.loads(result.stdout)["context"]["status"] == "incomplete"
    assert "Human exception." in (existing / ".gwrk/architecture.md").read_text()
    checks.append("Edited generated context survives re-init with an explicit conflict")
    package = fresh / ".gwrk/plugins/gwrk"
    marketplace = json.loads((fresh / ".gwrk/.claude-plugin/marketplace.json").read_text())
    assert marketplace["plugins"][0]["source"] == "./plugins/gwrk"
    assert json.loads((package / "gemini-extension.json").read_text())["contextFileName"] == "GEMINI.md"
    for relative in ("SKILL.md", "references/assessment.md"):
        assert (package / "skills/gwrk-assess" / relative).read_bytes() == (repo / "src/plugins/builtins/skills/gwrk-assess" / relative).read_bytes()
    checks.append("Claude and Codex marketplace and Gemini extension share the canonical skill")
print(json.dumps({"verdict": "PASS", "checks": checks}, indent=2))
