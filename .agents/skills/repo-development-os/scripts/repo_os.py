#!/usr/bin/env python3
"""Small helpers for the repository-local Development OS."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote


SKILL_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = SKILL_ROOT / "assets" / "repository"
STABLE_TAG_RE = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
CONVENTIONAL_RE = re.compile(
    r"^(?P<type>[a-z][a-z0-9-]*)(?:\([^)]+\))?(?P<breaking>!)?:\s+\S"
)
AGENTS_BEGIN = "<!-- repo-development-os:agents:begin -->"
AGENTS_END = "<!-- repo-development-os:agents:end -->"
PR_BEGIN = "<!-- repo-development-os:pr-template:begin -->"
PR_END = "<!-- repo-development-os:pr-template:end -->"
IGNORE_BEGIN = "# repo-development-os:gitignore:begin"
IGNORE_END = "# repo-development-os:gitignore:end"


class RepoOSError(RuntimeError):
    pass


def run(
    arguments: Sequence[str], *, cwd: Path, check: bool = True,
) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(
            list(arguments), cwd=str(cwd), text=True, capture_output=True, check=False,
        )
    except OSError as exc:
        raise RepoOSError(f"cannot run {arguments[0]}: {exc}") from exc
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise RepoOSError(f"{' '.join(arguments)} failed: {detail}")
    return result


def git(repo: Path, *arguments: str, check: bool = True) -> subprocess.CompletedProcess:
    return run(["git", *arguments], cwd=repo, check=check)


def repo_root(path: str) -> Path:
    candidate = Path(path).expanduser().resolve()
    result = run(["git", "rev-parse", "--show-toplevel"], cwd=candidate, check=False)
    if result.returncode != 0:
        raise RepoOSError(f"not inside a Git repository: {candidate}")
    return Path(result.stdout.strip()).resolve()


def within(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
        return True
    except ValueError:
        return False


def target_path(repo: Path, relative_path: str) -> Optional[Path]:
    pure = PurePosixPath(relative_path)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts or pure.parts[0] == ".git":
        return None
    target = repo.joinpath(*pure.parts)
    if not within(target.parent, repo):
        return None
    return target


def write_file(
    repo: Path, relative_path: str, content: bytes, *, dry_run: bool,
) -> str:
    target = target_path(repo, relative_path)
    if target is None:
        return f"SKIP {relative_path} (outside repository)"
    if target.exists() and target.is_symlink():
        return f"SKIP {relative_path} (symbolic link)"
    if target.exists() and target.is_file() and target.read_bytes() == content:
        return f"KEEP {relative_path}"
    if dry_run:
        return f"WRITE {relative_path}"
    target.parent.mkdir(parents=True, exist_ok=True)
    if not within(target.parent, repo):
        return f"SKIP {relative_path} (outside repository)"
    target.write_bytes(content)
    return f"WRITE {relative_path}"


def render_block(existing: str, block: str, begin: str, end: str) -> Optional[str]:
    managed = f"{begin}\n{block.rstrip()}\n{end}\n"
    begin_count = existing.count(begin)
    end_count = existing.count(end)
    if begin_count == 0 and end_count == 0:
        prefix = existing.rstrip()
        return f"{prefix}\n\n{managed}" if prefix else managed
    if begin_count != 1 or end_count != 1 or existing.index(begin) > existing.index(end):
        return None
    start = existing.index(begin)
    finish = existing.index(end, start) + len(end)
    return existing[:start] + managed.rstrip("\n") + existing[finish:]


def asset_text(relative_path: str) -> str:
    try:
        return (ASSET_ROOT / relative_path).read_text(encoding="utf-8")
    except OSError as exc:
        raise RepoOSError(f"cannot read package asset {relative_path}: {exc}") from exc


def package_files() -> Iterable[Path]:
    for path in sorted(SKILL_ROOT.rglob("*")):
        if (
            path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix not in {".pyc", ".pyo"}
        ):
            yield path


def install(repo: Path, *, dry_run: bool) -> int:
    messages: List[str] = []
    destination_skill = repo / ".agents" / "skills" / "repo-development-os"
    if destination_skill.resolve(strict=False) != SKILL_ROOT.resolve(strict=False):
        for source in package_files():
            relative = source.relative_to(SKILL_ROOT)
            destination = (
                PurePosixPath(".agents/skills/repo-development-os")
                / PurePosixPath(relative.as_posix())
            ).as_posix()
            messages.append(write_file(repo, destination, source.read_bytes(), dry_run=dry_run))

    block_specs = [
        ("AGENTS.md", "AGENTS.block.md", AGENTS_BEGIN, AGENTS_END),
        (
            ".github/pull_request_template.md",
            "PULL_REQUEST_TEMPLATE.block.md",
            PR_BEGIN,
            PR_END,
        ),
        (".gitignore", "GITIGNORE.block", IGNORE_BEGIN, IGNORE_END),
    ]
    for relative_path, asset_path, begin, end in block_specs:
        target = target_path(repo, relative_path)
        if target is None or (target.exists() and target.is_symlink()):
            messages.append(f"SKIP {relative_path}")
            continue
        existing = ""
        if target.exists():
            try:
                existing = target.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                messages.append(f"SKIP {relative_path} (not editable text)")
                continue
        rendered = render_block(existing, asset_text(asset_path), begin, end)
        if rendered is None:
            messages.append(f"SKIP {relative_path} (managed markers need manual repair)")
            continue
        messages.append(
            write_file(repo, relative_path, rendered.encode("utf-8"), dry_run=dry_run)
        )

    owned = [
        (".github/ISSUE_TEMPLATE/development.yml", ".github/ISSUE_TEMPLATE/development.yml"),
    ]
    for relative_path, asset_path in owned:
        target = target_path(repo, relative_path)
        if target is not None and target.exists():
            try:
                existing = target.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                existing = ""
            if "# repo-development-os:managed" not in existing:
                messages.append(f"SKIP {relative_path} (existing project file)")
                continue
        messages.append(
            write_file(
                repo, relative_path, asset_text(asset_path).encode("utf-8"), dry_run=dry_run,
            )
        )

    seeds = [
        ("CHANGELOG.md", "CHANGELOG.md"),
        ("docs/operations/DEVELOPMENT_RUNBOOK.md", "docs/operations/DEVELOPMENT_RUNBOOK.md"),
        ("docs/retrospectives/TEMPLATE.md", "docs/retrospectives/TEMPLATE.md"),
    ]
    for relative_path, asset_path in seeds:
        target = target_path(repo, relative_path)
        if target is not None and target.exists():
            messages.append(f"KEEP {relative_path}")
            continue
        messages.append(
            write_file(
                repo, relative_path, asset_text(asset_path).encode("utf-8"), dry_run=dry_run,
            )
        )

    for message in messages:
        print(message)
    return 0


def detect_base(repo: Path) -> Optional[str]:
    remote = git(
        repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD", check=False,
    )
    if remote.returncode == 0 and remote.stdout.strip().startswith("origin/"):
        return remote.stdout.strip().split("/", 1)[1]
    for candidate in ("main", "master"):
        if git(
            repo, "show-ref", "--verify", "--quiet", f"refs/heads/{candidate}", check=False,
        ).returncode == 0:
            return candidate
    return None


def status(repo: Path) -> Dict[str, Any]:
    branch = git(repo, "branch", "--show-current", check=False).stdout.strip() or None
    dirty = bool(git(repo, "status", "--porcelain", "--untracked-files=all").stdout.strip())
    base = detect_base(repo)
    changed_files: Optional[int] = None
    if base:
        base_ref = f"origin/{base}"
        if git(
            repo, "rev-parse", "--verify", f"{base_ref}^{{commit}}", check=False,
        ).returncode != 0:
            base_ref = base
        diff = git(repo, "diff", "--name-only", f"{base_ref}...HEAD", check=False)
        if diff.returncode == 0:
            changed_files = len(diff.stdout.splitlines())
    plan = release_plan(repo)
    return {
        "repository": str(repo),
        "branch": branch,
        "dirty": dirty,
        "base": base,
        "changed_files": changed_files,
        "release": {
            "baseline": plan["baseline"],
            "suggested_version": plan["next_version"],
        },
    }


def github_json(repo: Path, *arguments: str) -> Any:
    result = run(["gh", *arguments], cwd=repo, check=False)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise RepoOSError(f"gh {' '.join(arguments)} failed: {detail}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RepoOSError(f"gh {' '.join(arguments)} returned invalid JSON") from exc


def parse_time(value: str) -> dt.datetime:
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise RepoOSError(f"invalid GitHub timestamp: {value!r}") from exc
    if parsed.tzinfo is None:
        raise RepoOSError(f"GitHub timestamp has no timezone: {value!r}")
    return parsed.astimezone(dt.timezone.utc)


def closing_issues(body: str, repository: str) -> List[int]:
    numbers = set()
    for match in re.finditer(
        r"(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)"
        r"(?:\s*:\s*|\s+)"
        r"(?:(?P<repository>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+))?"
        r"#(?P<number>[0-9]+)\b",
        body,
    ):
        qualified = match.group("repository")
        if qualified and qualified.casefold() != repository.casefold():
            continue
        numbers.add(int(match.group("number")))
    return sorted(numbers)


def section_text(body: str, names: Sequence[str]) -> str:
    escaped = "|".join(re.escape(name) for name in names)
    match = re.search(
        rf"(?ims)^#{{1,6}}\s*(?:{escaped})\s*$\s*(.*?)(?=^#{{1,6}}\s|\Z)", body,
    )
    return match.group(1).strip() if match else ""


def issue_contract(body: str) -> List[str]:
    missing = []
    if not section_text(body, ("Goal", "목표")):
        missing.append("goal")
    if not section_text(body, ("Completion scenario", "완료 시나리오")):
        missing.append("completion scenario")
    acceptance = section_text(
        body, ("Measurable acceptance criteria", "Acceptance criteria", "측정 가능한 수용 기준"),
    )
    if not acceptance or re.search(r"(?m)^\s*[-*]\s+\[[ xX]\]\s+\S", acceptance) is None:
        missing.append("measurable acceptance criteria")
    return missing


def worktree_facts(repo: Path, base: str) -> List[Dict[str, Any]]:
    output = git(repo, "worktree", "list", "--porcelain").stdout
    records: List[Dict[str, str]] = []
    current: Dict[str, str] = {}
    for line in output.splitlines() + [""]:
        if not line:
            if current:
                records.append(current)
                current = {}
            continue
        key, _, value = line.partition(" ")
        current[key] = value
    if not records:
        raise RepoOSError("git reported no worktrees")
    primary = Path(records[0]["worktree"]).resolve()
    stable_root = primary.parent / f"{primary.name}-worktrees"
    facts = []
    for index, record in enumerate(records):
        path = Path(record["worktree"]).resolve()
        branch_ref = record.get("branch", "")
        branch = branch_ref.removeprefix("refs/heads/") or None
        dirty = bool(
            run(
                ["git", "status", "--porcelain", "--untracked-files=all"],
                cwd=path,
            ).stdout.strip()
        )
        upstream = run(
            ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            cwd=path,
            check=False,
        )
        ahead_upstream: Optional[int] = None
        behind_upstream: Optional[int] = None
        if upstream.returncode == 0:
            counts = run(
                ["git", "rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
                cwd=path,
            )
            behind_upstream, ahead_upstream = (int(value) for value in counts.stdout.split())
        facts.append({
            "path": str(path),
            "branch": branch,
            "dirty": dirty,
            "stable_location": index == 0 or within(path, stable_root),
            "has_upstream": upstream.returncode == 0,
            "ahead_upstream": ahead_upstream,
            "behind_upstream": behind_upstream,
        })
    return facts


def collect_preflight(repo: Path) -> Dict[str, Any]:
    repository = github_json(repo, "repo", "view", "--json", "nameWithOwner,defaultBranchRef")
    name = repository.get("nameWithOwner")
    default = (repository.get("defaultBranchRef") or {}).get("name")
    if not isinstance(name, str) or not isinstance(default, str):
        raise RepoOSError("cannot resolve GitHub repository and default branch")

    branch_pages = github_json(
        repo, "api", "--paginate", "--slurp", f"repos/{name}/branches?per_page=100",
    )
    if not isinstance(branch_pages, list) or any(not isinstance(page, list) for page in branch_pages):
        raise RepoOSError("GitHub branch response has an unexpected shape")
    branches = [item for page in branch_pages for item in page]

    pull_requests = github_json(
        repo,
        "pr", "list", "--repo", name, "--state", "all", "--limit", "1000", "--json",
        "number,state,headRefName,headRefOid,baseRefName,reviewDecision,"
        "latestReviews,updatedAt,body,url,changedFiles",
    )
    if not isinstance(pull_requests, list) or len(pull_requests) >= 1000:
        raise RepoOSError("cannot verify all pull requests within the 1000-item bound")
    for pull_request in pull_requests:
        if pull_request.get("state") != "OPEN":
            pull_request["commits"] = []
            continue
        details = github_json(
            repo,
            "pr", "view", str(pull_request["number"]), "--repo", name, "--json", "commits",
        )
        commits = details.get("commits") or []
        for commit in commits:
            oid = commit.get("oid")
            subject = git(repo, "show", "-s", "--format=%s", oid, check=False) if oid else None
            if subject is not None and subject.returncode == 0:
                commit["subject"] = subject.stdout.strip()
                continue
            remote_commit = github_json(repo, "api", f"repos/{name}/commits/{oid}")
            message = ((remote_commit.get("commit") or {}).get("message") or "")
            commit["subject"] = message.splitlines()[0] if message else ""
        pull_request["commits"] = commits

    active_branches = []
    default_sha = None
    for branch in branches:
        branch_name = branch.get("name")
        branch_sha = (branch.get("commit") or {}).get("sha")
        if branch_name == default:
            default_sha = branch_sha
            continue
        if not isinstance(branch_name, str) or not isinstance(branch_sha, str):
            raise RepoOSError("GitHub branch response is missing a name or SHA")
        if branch_name.startswith("archive/"):
            continue
        comparison = github_json(
            repo,
            "api",
            f"repos/{name}/compare/{quote(default, safe='')}...{quote(branch_name, safe='')}",
        )
        active_branches.append({
            "name": branch_name,
            "sha": branch_sha,
            "ahead_by": int(comparison.get("ahead_by", 0)),
        })
    if not isinstance(default_sha, str):
        raise RepoOSError(f"GitHub branch list has no default branch {default}")

    default_ref = f"refs/remotes/origin/{default}"
    local_default = git(
        repo, "rev-parse", "--verify", f"{default_ref}^{{commit}}", check=False,
    )
    if local_default.returncode != 0:
        raise RepoOSError(f"missing local {default_ref}; fetch the default branch")
    if local_default.stdout.strip() != default_sha:
        raise RepoOSError(f"local origin/{default} is stale; fetch before preflight")

    default_commit = github_json(repo, "api", f"repos/{name}/commits/{default_sha}")
    default_date = ((default_commit.get("commit") or {}).get("committer") or {}).get("date")
    if not isinstance(default_date, str):
        raise RepoOSError("GitHub default-branch commit has no committer date")

    tag_pages = github_json(
        repo, "api", "--paginate", "--slurp", f"repos/{name}/tags?per_page=100",
    )
    if not isinstance(tag_pages, list) or any(not isinstance(page, list) for page in tag_pages):
        raise RepoOSError("GitHub tag response has an unexpected shape")
    tags = {
        item["name"]
        for page in tag_pages
        for item in page
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }
    releases = github_json(
        repo,
        "release", "list", "--repo", name, "--limit", "1000", "--json",
        "tagName,isDraft,publishedAt",
    )
    if not isinstance(releases, list) or len(releases) >= 1000:
        raise RepoOSError("cannot verify all releases within the 1000-item bound")

    changelog = git(repo, "show", f"{default_ref}:CHANGELOG.md", check=False)
    changelog_text = changelog.stdout if changelog.returncode == 0 else ""
    changelog_versions = sorted(set(re.findall(
        r"(?m)^## \[([0-9]+\.[0-9]+\.[0-9]+)\](?:\s+-\s+[0-9]{4}-[0-9]{2}-[0-9]{2})?\s*$",
        changelog_text,
    )))
    release_reports = {
        version
        for version in changelog_versions
        if git(
            repo, "cat-file", "-e", f"{default_ref}:docs/releases/v{version}.md", check=False,
        ).returncode == 0
    }
    tag_on_default: Dict[str, bool] = {}
    for version in changelog_versions:
        tag = f"v{version}"
        if tag not in tags:
            continue
        comparison = github_json(
            repo,
            "api",
            f"repos/{name}/compare/{quote(tag, safe='')}...{quote(default, safe='')}",
        )
        tag_on_default[tag] = comparison.get("status") in {"ahead", "identical"}

    worktrees = worktree_facts(repo, default)
    active_issue_numbers = {
        int(match.group(1))
        for worktree in worktrees
        for match in [re.search(r"(?:^|/)issue-([0-9]+)(?:-|$)", worktree.get("branch") or "")]
        if match
    }
    open_issues = github_json(
        repo, "issue", "list", "--repo", name, "--state", "open", "--limit", "1000", "--json",
        "number,state,body,url",
    )
    if not isinstance(open_issues, list) or len(open_issues) >= 1000:
        raise RepoOSError("cannot verify all open issues within the 1000-item bound")
    issues = {int(issue["number"]): issue for issue in open_issues}
    for number in sorted(active_issue_numbers - set(issues)):
        issues[number] = github_json(
            repo, "issue", "view", str(number), "--repo", name, "--json", "state,body,url",
        )

    return {
        "repository": name,
        "default_branch": default,
        "default_sha": default_sha,
        "default_committed_at": default_date,
        "worktrees": worktrees,
        "branches": active_branches,
        "pull_requests": pull_requests,
        "tags": sorted(tags),
        "releases": releases,
        "changelog_versions": changelog_versions,
        "release_reports": sorted(release_reports),
        "tag_on_default": tag_on_default,
        "issues": issues,
    }


def finding(code: str, message: str, url: Optional[str] = None) -> Dict[str, str]:
    item = {"code": code, "message": message}
    if url:
        item["url"] = url
    return item


def preflight_findings(
    state: Dict[str, Any], *, now: Optional[dt.datetime] = None,
) -> List[Dict[str, str]]:
    now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    findings: List[Dict[str, str]] = []
    default = state["default_branch"]

    for worktree in state["worktrees"]:
        if worktree["dirty"]:
            findings.append(finding(
                "worktree.dirty", f"worktree has uncommitted files: {worktree['path']}",
            ))
        if not worktree["stable_location"]:
            findings.append(finding(
                "worktree.location", f"linked worktree is outside the stable sibling root: {worktree['path']}",
            ))
        branch = worktree.get("branch")
        if not branch:
            findings.append(finding(
                "worktree.detached", f"worktree is detached: {worktree['path']}",
            ))
        if branch and branch != default and re.search(r"(?:^|/)issue-[0-9]+(?:-|$)", branch) is None:
            findings.append(finding(
                "branch.issue-name", f"worktree branch does not identify one issue: {branch}",
            ))
        issue_match = re.search(r"(?:^|/)issue-([0-9]+)(?:-|$)", branch or "")
        if issue_match:
            number = int(issue_match.group(1))
            issue = state.get("issues", {}).get(number)
            if issue is None:
                findings.append(finding(
                    "issue.unverified", f"cannot verify issue #{number} for branch {branch}",
                ))
            elif issue.get("state") != "OPEN":
                findings.append(finding(
                    "issue.closed-active", f"branch {branch} still has a worktree but issue #{number} is not open",
                    issue.get("url"),
                ))
            else:
                missing = issue_contract(issue.get("body") or "")
                if missing:
                    findings.append(finding(
                        "issue.contract",
                        f"issue #{number} is missing {', '.join(missing)}",
                        issue.get("url"),
                    ))
        if branch and branch != default and not worktree.get("has_upstream"):
            findings.append(finding(
                "branch.no-upstream", f"issue branch has no upstream: {branch}",
            ))
        if (worktree.get("ahead_upstream") or 0) > 0:
            findings.append(finding(
                "commit.unpushed",
                f"branch {branch or 'detached'} has {worktree['ahead_upstream']} commit(s) not present on its upstream",
            ))
        if (worktree.get("behind_upstream") or 0) > 0:
            findings.append(finding(
                "branch.behind-upstream",
                f"branch {branch or 'detached'} is {worktree['behind_upstream']} commit(s) behind its upstream",
            ))

    pull_requests = state["pull_requests"]
    for branch in state["branches"]:
        if branch["ahead_by"] <= 0:
            continue
        matches = [
            pull_request
            for pull_request in pull_requests
            if pull_request.get("headRefName") == branch["name"]
            and pull_request.get("headRefOid") == branch["sha"]
        ]
        if not matches:
            findings.append(finding(
                "commit.without-pr",
                f"branch {branch['name']} is {branch['ahead_by']} commit(s) ahead of {default} without a pull request for its current head",
            ))
            continue
        if not any(
            item.get("state") == "OPEN"
            or (item.get("state") == "MERGED" and item.get("baseRefName") == default)
            for item in matches
        ):
            findings.append(finding(
                "main.unreflected",
                f"branch {branch['name']} remains ahead of {default} without a merge into {default}",
                matches[0].get("url"),
            ))

    open_pull_requests = [item for item in pull_requests if item.get("state") == "OPEN"]
    for pull_request in open_pull_requests:
        url = pull_request.get("url")
        issues = closing_issues(pull_request.get("body") or "", state["repository"])
        if not issues:
            findings.append(finding(
                "pr.issue-link", f"PR #{pull_request['number']} has no closing issue reference", url,
            ))
        if len(issues) > 3:
            findings.append(finding(
                "pr.issue-limit", f"PR #{pull_request['number']} closes {len(issues)} issues; limit is 3", url,
            ))
        if int(pull_request.get("changedFiles") or 0) > 50:
            findings.append(finding(
                "pr.file-limit", f"PR #{pull_request['number']} changes {pull_request['changedFiles']} files; limit is 50", url,
            ))
        allowed = set(issues)
        for commit in pull_request.get("commits") or []:
            subject = commit.get("subject") or ""
            references = set(issue_references(subject))
            if not references:
                findings.append(finding(
                    "commit.issue-link", f"PR #{pull_request['number']} commit has no issue number: {subject}", url,
                ))
            elif allowed and not references.issubset(allowed):
                findings.append(finding(
                    "commit.issue-mismatch",
                    f"PR #{pull_request['number']} commit references {sorted(references)} outside closing issues {issues}: {subject}",
                    url,
                ))
        if pull_request.get("baseRefName") != default:
            findings.append(finding(
                "pr.wrong-base", f"PR #{pull_request['number']} targets {pull_request.get('baseRefName')}, not {default}", url,
            ))
        if pull_request.get("reviewDecision") == "APPROVED":
            approved = [
                review.get("submittedAt")
                for review in pull_request.get("latestReviews") or []
                if review.get("state") == "APPROVED" and review.get("submittedAt")
            ]
            reviewed_at = max((parse_time(value) for value in approved), default=parse_time(pull_request["updatedAt"]))
            if now - reviewed_at >= dt.timedelta(hours=24):
                findings.append(finding(
                    "pr.merge-overdue",
                    f"approved PR #{pull_request['number']} has remained unmerged for at least 24 hours",
                    url,
                ))

    if open_pull_requests and now - parse_time(state["default_committed_at"]) >= dt.timedelta(hours=72):
        findings.append(finding(
            "main.stale",
            f"{default} has not advanced for at least 72 hours while pull requests remain open",
        ))

    tags = set(state["tags"])
    published = {
        release["tagName"]
        for release in state["releases"]
        if not release.get("isDraft") and release.get("publishedAt")
    }
    reports = set(state["release_reports"])
    for version in state["changelog_versions"]:
        tag = f"v{version}"
        if tag not in tags:
            findings.append(finding(
                "release.tag-missing", f"{default} records {version} in CHANGELOG but tag {tag} does not exist",
            ))
        elif tag not in published:
            findings.append(finding(
                "release.publication-missing", f"tag {tag} has no published GitHub Release",
            ))
        if tag in tags and not state.get("tag_on_default", {}).get(tag, False):
            findings.append(finding(
                "release.tag-off-main", f"tag {tag} is not contained in {default}",
            ))
        if version not in reports:
            findings.append(finding(
                "release.report-missing", f"{default} records {version} without docs/releases/v{version}.md",
            ))

    for number, issue in state.get("issues", {}).items():
        merged_closer = any(
            pull_request.get("state") == "MERGED"
            and pull_request.get("baseRefName") == default
            and number in closing_issues(
                pull_request.get("body") or "", state["repository"],
            )
            for pull_request in pull_requests
        )
        if merged_closer and issue.get("state") == "OPEN":
            findings.append(finding(
                "issue.open-after-merge", f"issue #{number} remains open after a merged closing pull request",
                issue.get("url"),
            ))
    return findings


def preflight(repo: Path, output_format: str) -> int:
    state = collect_preflight(repo)
    findings = preflight_findings(state)
    payload = {
        "repository": state["repository"],
        "default_branch": state["default_branch"],
        "status": "cleanup-required" if findings else "clean",
        "findings": findings,
    }
    if output_format == "json":
        print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    elif findings:
        print(f"Preflight: {len(findings)} cleanup finding(s)")
        for item in findings:
            print(f"[{item['code']}] {item['message']}")
            if item.get("url"):
                print(f"  {item['url']}")
    else:
        print("Preflight: clean")
    return 1 if findings else 0


def parse_semver(tag: Optional[str]) -> Optional[Tuple[int, int, int]]:
    if not tag:
        return None
    match = STABLE_TAG_RE.fullmatch(tag)
    if not match:
        return None
    return tuple(int(value) for value in match.groups())  # type: ignore[return-value]


def stable_tags(repo: Path, ref: str) -> List[str]:
    result = git(repo, "tag", "--merged", ref, "--list", "v*", check=False)
    if result.returncode != 0:
        return []
    return sorted(
        {tag for tag in result.stdout.splitlines() if parse_semver(tag) is not None},
        key=lambda tag: parse_semver(tag) or (0, 0, 0),
        reverse=True,
    )


def issue_references(subject: str) -> List[int]:
    return sorted({int(value) for value in re.findall(r"(?<!\w)#([0-9]+)", subject)})


def conventional_commits(
    repo: Path, baseline: Optional[str], ref: str,
) -> List[Dict[str, Any]]:
    range_spec = f"{baseline}..{ref}" if baseline else ref
    result = git(
        repo, "log", "--first-parent", "--reverse", "--format=%H%x1f%s%x1f%b%x1e",
        range_spec, check=False,
    )
    if result.returncode != 0:
        return []
    commits = []
    for record in result.stdout.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        parts = record.split("\x1f", 2)
        if len(parts) != 3:
            continue
        commit, subject, body = parts
        if subject.startswith(("fixup! ", "squash! ")):
            continue
        match = CONVENTIONAL_RE.match(subject)
        commit_type = match.group("type") if match else "other"
        breaking = bool(match and match.group("breaking")) or bool(
            re.search(r"(?m)^BREAKING(?: CHANGE|-CHANGE):\s+\S", body)
        )
        commits.append({
            "commit": commit,
            "subject": subject,
            "type": commit_type,
            "breaking": breaking,
            "references": issue_references(subject),
        })
    return commits


def required_bump(commits: Sequence[Dict[str, Any]]) -> str:
    if any(commit["breaking"] for commit in commits):
        return "major"
    if any(commit["type"] == "feat" for commit in commits):
        return "minor"
    if any(commit["type"] == "fix" for commit in commits):
        return "patch"
    return "none"


def next_version(baseline: Optional[str], bump: str) -> Optional[str]:
    if bump == "none":
        return None
    major, minor, patch = parse_semver(baseline or "v0.0.0") or (0, 0, 0)
    if bump == "major":
        major, minor, patch = major + 1, 0, 0
    elif bump == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return f"v{major}.{minor}.{patch}"


def release_plan(repo: Path, ref: str = "HEAD") -> Dict[str, Any]:
    tags = stable_tags(repo, ref)
    baseline = tags[0] if tags else None
    commits = conventional_commits(repo, baseline, ref)
    bump = required_bump(commits)
    return {
        "baseline": baseline,
        "bump": bump,
        "next_version": next_version(baseline, bump),
        "commits": commits,
    }


def valid_version(value: str) -> str:
    if STABLE_TAG_RE.fullmatch(value) is None:
        raise RepoOSError("version must use vMAJOR.MINOR.PATCH")
    return value


def valid_date(value: str) -> str:
    try:
        return dt.date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise RepoOSError("date must use YYYY-MM-DD") from exc


def changelog_section(version: str, date: str, commits: Sequence[Dict[str, Any]]) -> str:
    lines = [f"## [{version[1:]}] - {date}"]
    for commit in commits:
        lines.append(f"- {commit['subject']}")
    return "\n".join(lines) + "\n"


def update_changelog(existing: str, section: str) -> str:
    marker = "## [Unreleased]"
    if marker not in existing:
        existing = existing.rstrip() + f"\n\n{marker}\n"
    version_heading = section.splitlines()[0].split(" - ", 1)[0]
    previous = re.compile(
        rf"(?ms)^{re.escape(version_heading)}(?: - [0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}})?\s*$"
        rf".*?(?=^## \[|\Z)"
    )
    if previous.search(existing):
        return previous.sub(section.rstrip() + "\n\n", existing, count=1).rstrip() + "\n"
    marker_end = existing.index(marker) + len(marker)
    next_version = re.search(r"(?m)^## \[", existing[marker_end:])
    insert_at = marker_end + next_version.start() if next_version else len(existing)
    prefix = existing[:insert_at].rstrip()
    suffix = existing[insert_at:].lstrip()
    updated = f"{prefix}\n\n{section.rstrip()}\n"
    if suffix:
        updated += f"\n{suffix}"
    return updated.rstrip() + "\n"


def prepare_release(args: argparse.Namespace, repo: Path) -> int:
    plan = release_plan(repo)
    suggested = plan["next_version"]
    if suggested is None:
        print("No release suggested by Conventional Commits")
        return 0
    if args.version and valid_version(args.version) != suggested:
        raise RepoOSError(
            f"requested {args.version}; Conventional Commits require {suggested}"
        )
    version = suggested
    date = valid_date(args.date or dt.date.today().isoformat())
    validations = [item.strip() for item in args.validation if item.strip()]
    rollback = (args.rollback or "").strip()
    if not validations or not rollback:
        raise RepoOSError("release preparation requires validation and rollback evidence")
    changelog = repo / "CHANGELOG.md"
    existing = changelog.read_text(encoding="utf-8") if changelog.exists() else "# Changelog\n"
    section = changelog_section(version, date, plan["commits"])
    report = "\n".join([
        f"# {version} update report",
        "",
        f"- Date: {date}",
        f"- Suggested by helper: {plan['next_version'] or 'none'}",
        "",
        "## Changes",
        "",
        *[f"- {commit['subject']}" for commit in plan["commits"]],
        "",
        "## Validation",
        "",
        *[f"- {item}" for item in validations],
        "",
        "## Rollback",
        "",
        f"- {rollback}",
        "",
    ])
    report_path = repo / "docs" / "releases" / f"{version}.md"
    if not args.write:
        print(json.dumps({
            "version": version,
            "suggested_version": plan["next_version"],
            "changelog": str(changelog.relative_to(repo)),
            "report": str(report_path.relative_to(repo)),
        }, sort_keys=True))
        return 0
    changelog.write_text(update_changelog(existing, section), encoding="utf-8")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")
    print(f"Wrote {changelog.relative_to(repo)} and {report_path.relative_to(repo)}")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Optional Repository Development OS helpers")
    commands = root.add_subparsers(dest="command", required=True)

    install_command = commands.add_parser("install")
    install_command.add_argument("--repo", required=True)
    install_command.add_argument("--dry-run", action="store_true")

    status_command = commands.add_parser("status")
    status_command.add_argument("--repo", required=True)
    status_command.add_argument("--format", choices=("human", "json"), default="human")

    preflight_command = commands.add_parser("preflight")
    preflight_command.add_argument("--repo", required=True)
    preflight_command.add_argument("--format", choices=("human", "json"), default="human")

    plan_command = commands.add_parser("release-plan")
    plan_command.add_argument("--repo", required=True)
    plan_command.add_argument("--ref", default="HEAD")

    prepare_command = commands.add_parser("prepare-release")
    prepare_command.add_argument("--repo", required=True)
    prepare_command.add_argument("--version")
    prepare_command.add_argument("--date")
    prepare_command.add_argument("--validation", action="append", default=[])
    prepare_command.add_argument("--rollback")
    prepare_command.add_argument("--write", action="store_true")
    return root


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parser().parse_args(argv)
    try:
        repo = repo_root(args.repo)
        if args.command == "install":
            return install(repo, dry_run=args.dry_run)
        if args.command == "status":
            facts = status(repo)
            if args.format == "json":
                print(json.dumps(facts, sort_keys=True, separators=(",", ":")))
            else:
                print(f"Repository: {facts['repository']}")
                print(f"Branch: {facts['branch'] or 'detached'}")
                print(f"Dirty: {'yes' if facts['dirty'] else 'no'}")
                print(f"Base: {facts['base'] or 'unknown'}")
                print(f"Changed files: {facts['changed_files'] if facts['changed_files'] is not None else 'unknown'}")
                print(f"Suggested release: {facts['release']['suggested_version'] or 'none'}")
            return 0
        if args.command == "preflight":
            return preflight(repo, args.format)
        if args.command == "release-plan":
            print(json.dumps(release_plan(repo, args.ref), sort_keys=True, separators=(",", ":")))
            return 0
        if args.command == "prepare-release":
            return prepare_release(args, repo)
        raise RepoOSError(f"unknown command: {args.command}")
    except (OSError, RepoOSError) as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
