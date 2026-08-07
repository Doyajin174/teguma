from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "repo_os.py"
SPEC = importlib.util.spec_from_file_location("repo_os", SCRIPT)
repo_os = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = repo_os
SPEC.loader.exec_module(repo_os)


def command(cwd: Path, *arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(arguments), cwd=str(cwd), text=True, capture_output=True, check=False,
    )


class RepoOSHelperTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def create_repo(self, name: str = "repository") -> Path:
        repo = self.root / name
        repo.mkdir()
        initialized = command(repo, "git", "init", "-b", "main")
        self.assertEqual(initialized.returncode, 0, initialized.stderr)
        command(repo, "git", "config", "user.name", "Repo OS Test")
        command(repo, "git", "config", "user.email", "repo-os@example.invalid")
        (repo / "README.md").write_text("# Fixture\n", encoding="utf-8")
        self.commit(repo, "chore: initialize fixture (#1)")
        return repo

    def commit(self, repo: Path, subject: str, body: str = "") -> str:
        command(repo, "git", "add", "-A")
        arguments = ["git", "commit", "-m", subject]
        if body:
            arguments.extend(["-m", body])
        result = command(repo, *arguments)
        self.assertEqual(result.returncode, 0, result.stderr)
        return command(repo, "git", "rev-parse", "HEAD").stdout.strip()

    def test_repo_root_accepts_a_path_inside_the_selected_repository(self) -> None:
        repo = self.create_repo()
        nested = repo / "packages" / "app"
        nested.mkdir(parents=True)
        self.assertEqual(repo_os.repo_root(str(nested)), repo)

    def test_install_preserves_project_text_and_is_repeatable(self) -> None:
        repo = self.create_repo()
        (repo / "AGENTS.md").write_text("# Existing instructions\n", encoding="utf-8")
        (repo / ".github").mkdir()
        (repo / ".github/pull_request_template.md").write_text(
            "Existing PR notes.\n", encoding="utf-8",
        )
        (repo / "unrelated.txt").write_text("dirty\n", encoding="utf-8")

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(repo_os.install(repo, dry_run=False), 0)
        agents = (repo / "AGENTS.md").read_text(encoding="utf-8")
        pr = (repo / ".github/pull_request_template.md").read_text(encoding="utf-8")
        self.assertIn("# Existing instructions", agents)
        self.assertIn("repo-development-os:agents:begin", agents)
        normalized_agents = " ".join(agents.split())
        self.assertIn("Load and follow `tidy` without waiting", normalized_agents)
        self.assertIn("not attach a broad tidy pass", normalized_agents)
        self.assertIn(
            "load and follow `maintain-code-atlas` without waiting", normalized_agents,
        )
        self.assertIn("update only directly affected cards", normalized_agents)
        self.assertIn("Existing PR notes.", pr)
        self.assertEqual((repo / "unrelated.txt").read_text(encoding="utf-8"), "dirty\n")
        installed_skill = (
            repo / ".agents/skills/repo-development-os/SKILL.md"
        ).read_text(encoding="utf-8")
        normalized_skill = " ".join(installed_skill.split())
        self.assertIn("## Practical routing", installed_skill)
        self.assertIn("ordinary feature or fix work", normalized_skill)
        self.assertIn("Never bulk-create or refresh unrelated cards", normalized_skill)
        before = {
            path.relative_to(repo).as_posix(): path.read_bytes()
            for path in repo.rglob("*")
            if path.is_file() and ".git" not in path.parts
        }
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(repo_os.install(repo, dry_run=False), 0)
        after = {
            path.relative_to(repo).as_posix(): path.read_bytes()
            for path in repo.rglob("*")
            if path.is_file() and ".git" not in path.parts
        }
        self.assertEqual(before, after)
        self.assertFalse((repo / ".repo-os").exists())
        self.assertFalse((repo / ".github/workflows/repo-os.yml").exists())
        self.assertFalse((repo / ".github/workflows/release.yml").exists())

    def test_install_leaves_an_existing_project_issue_template_alone(self) -> None:
        repo = self.create_repo()
        template = repo / ".github/ISSUE_TEMPLATE/development.yml"
        template.parent.mkdir(parents=True)
        template.write_text("name: project-specific\n", encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            repo_os.install(repo, dry_run=False)
        self.assertEqual(template.read_text(encoding="utf-8"), "name: project-specific\n")

    def test_status_reports_facts_without_warnings_or_exit_gates(self) -> None:
        repo = self.create_repo()
        (repo / "dirty.txt").write_text("dirty\n", encoding="utf-8")
        facts = repo_os.status(repo)
        self.assertEqual(facts["branch"], "main")
        self.assertTrue(facts["dirty"])
        self.assertNotIn("warnings", facts)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(
                repo_os.main(["status", "--repo", str(repo), "--format", "json"]),
                0,
            )
        self.assertTrue(json.loads(output.getvalue())["dirty"])

    def test_release_plan_uses_conventional_commits(self) -> None:
        repo = self.create_repo()
        command(repo, "git", "tag", "v1.2.3")
        (repo / "feature.txt").write_text("feature\n", encoding="utf-8")
        self.commit(repo, "feat: add capability (#2)")
        self.assertEqual(repo_os.release_plan(repo)["next_version"], "v1.3.0")
        command(repo, "git", "tag", "v1.3.0")
        (repo / "fix.txt").write_text("fix\n", encoding="utf-8")
        self.commit(repo, "fix: correct capability (#3)")
        self.assertEqual(repo_os.release_plan(repo)["next_version"], "v1.3.1")

    def test_preflight_reports_cleanup_debt(self) -> None:
        now = dt.datetime(2026, 8, 6, tzinfo=dt.timezone.utc)
        state = {
            "repository": "owner/repository",
            "default_branch": "main",
            "default_committed_at": "2026-08-01T00:00:00Z",
            "worktrees": [{
                "path": "/repo-worktrees/issue-2-feature",
                "branch": "codex/issue-2-feature",
                "dirty": True,
                "stable_location": True,
                "has_upstream": True,
                "ahead_upstream": 1,
                "behind_upstream": 0,
            }],
            "branches": [{"name": "feature/orphan", "sha": "abc", "ahead_by": 2}],
            "pull_requests": [
                {
                    "number": 7,
                    "state": "OPEN",
                    "headRefName": "reviewed",
                    "headRefOid": "def",
                    "baseRefName": "main",
                    "reviewDecision": "APPROVED",
                    "latestReviews": [{"state": "APPROVED", "submittedAt": "2026-08-04T00:00:00Z"}],
                    "updatedAt": "2026-08-04T00:00:00Z",
                    "body": "No closing issue.",
                    "url": "https://example.invalid/pull/7",
                    "changedFiles": 51,
                    "commits": [{"subject": "feat: missing trace"}],
                },
                {"number": 8, "state": "MERGED", "baseRefName": "main", "body": "Closes #9"},
            ],
            "tags": [],
            "releases": [],
            "changelog_versions": ["1.2.0"],
            "release_reports": [],
            "tag_on_default": {},
            "issues": {
                2: {
                    "state": "OPEN",
                    "body": "## Goal\nG\n## Completion scenario\nC\n## Acceptance criteria\n- [ ] A",
                },
                9: {"state": "OPEN", "body": "", "url": "https://example.invalid/issues/9"},
            },
        }
        codes = {item["code"] for item in repo_os.preflight_findings(state, now=now)}
        self.assertTrue({
            "worktree.dirty",
            "commit.unpushed",
            "commit.without-pr",
            "pr.issue-link",
            "pr.file-limit",
            "commit.issue-link",
            "pr.merge-overdue",
            "main.stale",
            "release.tag-missing",
            "release.report-missing",
            "issue.open-after-merge",
        }.issubset(codes))

    def test_preflight_accepts_clean_current_work(self) -> None:
        state = {
            "repository": "owner/repository",
            "default_branch": "main",
            "default_committed_at": "2026-08-06T00:00:00Z",
            "worktrees": [{
                "path": "/repo-worktrees/issue-2-feature",
                "branch": "codex/issue-2-feature",
                "dirty": False,
                "stable_location": True,
                "has_upstream": True,
                "ahead_upstream": 0,
                "behind_upstream": 0,
            }],
            "branches": [{"name": "codex/issue-2-feature", "sha": "abc", "ahead_by": 1}],
            "pull_requests": [{
                "number": 3,
                "state": "OPEN",
                "headRefName": "codex/issue-2-feature",
                "headRefOid": "abc",
                "baseRefName": "main",
                "reviewDecision": "",
                "latestReviews": [],
                "updatedAt": "2026-08-06T00:00:00Z",
                "body": "Closes #2",
                "url": "https://example.invalid/pull/3",
                "changedFiles": 2,
                "commits": [{"subject": "feat: add behavior (#2)"}],
            }],
            "tags": ["v1.2.3"],
            "releases": [{"tagName": "v1.2.3", "isDraft": False, "publishedAt": "2026-08-06T00:00:00Z"}],
            "changelog_versions": ["1.2.3"],
            "release_reports": ["1.2.3"],
            "tag_on_default": {"v1.2.3": True},
            "issues": {
                2: {
                    "state": "OPEN",
                    "body": "## Goal\nG\n## Completion scenario\nC\n## Acceptance criteria\n- [ ] A",
                    "url": "https://example.invalid/issues/2",
                },
            },
        }
        self.assertEqual(
            repo_os.preflight_findings(
                state, now=dt.datetime(2026, 8, 6, 1, tzinfo=dt.timezone.utc),
            ),
            [],
        )

    def test_closing_issues_match_github_syntax(self) -> None:
        body = "\n".join([
            "Closes: #61",
            "Fixes Doyajin174/orchestrator#62",
            "Resolves other/repository#63",
            "Closes 64",
            "Fixes https://github.com/other/repository/issues/65",
        ])
        self.assertEqual(
            repo_os.closing_issues(body, "Doyajin174/orchestrator"),
            [61, 62],
        )

    def test_non_default_merged_pr_is_not_reflected_in_main(self) -> None:
        state = {
            "repository": "owner/repository",
            "default_branch": "main",
            "default_committed_at": "2026-08-06T00:00:00Z",
            "worktrees": [],
            "branches": [{"name": "codex/issue-9-change", "sha": "abc", "ahead_by": 1}],
            "pull_requests": [{
                "number": 10,
                "state": "MERGED",
                "headRefName": "codex/issue-9-change",
                "headRefOid": "abc",
                "baseRefName": "develop",
                "body": "Closes #9",
                "url": "https://example.invalid/pull/10",
            }],
            "tags": [],
            "releases": [],
            "changelog_versions": [],
            "release_reports": [],
            "tag_on_default": {},
            "issues": {
                9: {"state": "OPEN", "body": "", "url": "https://example.invalid/issues/9"},
            },
        }
        codes = {item["code"] for item in repo_os.preflight_findings(
            state, now=dt.datetime(2026, 8, 6, 1, tzinfo=dt.timezone.utc),
        )}
        self.assertIn("main.unreflected", codes)
        self.assertNotIn("issue.open-after-merge", codes)

    def test_prepare_release_requires_computed_version(self) -> None:
        repo = self.create_repo()
        (repo / "CHANGELOG.md").write_text(
            "# Changelog\n\n## [Unreleased]\n\n- Keep pending.\n", encoding="utf-8",
        )
        command(repo, "git", "tag", "v1.0.0")
        (repo / "feature.txt").write_text("feature\n", encoding="utf-8")
        self.commit(repo, "feat: add behavior (#2)")
        wrong = argparse.Namespace(
            version="v2.0.0",
            date="2026-08-05",
            validation=["human-reviewed evidence"],
            rollback="revert the release commit",
            write=False,
        )
        with self.assertRaises(repo_os.RepoOSError):
            repo_os.prepare_release(wrong, repo)
        args = argparse.Namespace(
            version="v1.1.0",
            date="2026-08-05",
            validation=["human-reviewed evidence"],
            rollback="revert the release commit",
            write=True,
        )
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(repo_os.prepare_release(args, repo), 0)
        changelog = (repo / "CHANGELOG.md").read_text(encoding="utf-8")
        report = (repo / "docs/releases/v1.1.0.md").read_text(encoding="utf-8")
        self.assertIn("Keep pending.", changelog)
        self.assertIn("## [1.1.0] - 2026-08-05", changelog)
        self.assertLess(
            changelog.index("Keep pending."),
            changelog.index("## [1.1.0] - 2026-08-05"),
        )
        self.assertIn("Suggested by helper: v1.1.0", report)

    def test_prepare_release_requires_validation_and_rollback(self) -> None:
        repo = self.create_repo()
        (repo / "feature.txt").write_text("feature\n", encoding="utf-8")
        self.commit(repo, "feat: add behavior (#2)")
        args = argparse.Namespace(
            version="v0.1.0", date="2026-08-05", validation=[], rollback=None, write=False,
        )
        with self.assertRaises(repo_os.RepoOSError):
            repo_os.prepare_release(args, repo)

    def test_package_has_no_automatic_gate_surface(self) -> None:
        package = Path(__file__).resolve().parents[1]
        self.assertFalse(
            (package / "assets/repository/.github/workflows/repo-os.yml").exists()
        )
        self.assertFalse(
            (package / "assets/repository/.github/workflows/release.yml").exists()
        )
        self.assertFalse(
            (package / "assets/repository/.repo-os/config.json.template").exists()
        )
        help_text = io.StringIO()
        with contextlib.redirect_stdout(help_text):
            with self.assertRaises(SystemExit):
                repo_os.parser().parse_args(["--help"])
        rendered = help_text.getvalue()
        self.assertIn("preflight", rendered)
        for removed in ("doctor", "pr-check", "issue-check", "verify-release-tag"):
            self.assertNotIn(removed, rendered)

    def test_managed_templates_require_the_operating_evidence(self) -> None:
        package = Path(__file__).resolve().parents[1]
        issue = (package / "assets/repository/.github/ISSUE_TEMPLATE/development.yml").read_text(
            encoding="utf-8",
        )
        pull_request = (package / "assets/repository/PULL_REQUEST_TEMPLATE.block.md").read_text(
            encoding="utf-8",
        )
        self.assertEqual(issue.count("required: true"), 3)
        for evidence in ("Research", "Self-review", "Independent AI review", "Squash merge"):
            self.assertIn(evidence, pull_request)


if __name__ == "__main__":
    unittest.main()
