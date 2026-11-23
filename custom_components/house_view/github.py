"""Manual backup / restore of the House View documents to a private GitHub repository (REST "contents" API).

Each document is one file `<path>/<key>.json` on the configured branch. A backup only commits the files whose content
changed (same git blob sha = nothing to do); a restore reads the raw files back and validates them before storing.

A backup writes one commit per file: each one is written on its own, so that a file GitHub refuses does not keep the
following ones from being saved, and the result says what was written, what was already up to date and what failed.
Two commits in a row on the same branch can collide (GitHub 409 / 422): the sha is read again and the file written
once more.
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

import aiohttp

API = "https://api.github.com"
TIMEOUT = aiohttp.ClientTimeout(total=120)


class GitHubError(Exception):
    """GitHub answered with an error (message shown to the user); `status` is its HTTP status when there was one."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status

    @property
    def conflict(self) -> bool:
        """The commit collided with another one: writing the file again, on the sha read anew, usually goes through."""
        return self.status in (409, 422)


def blob_sha(content: bytes) -> str:
    """Git blob id of a file content, as GitHub reports it."""
    return hashlib.sha1(b"blob %d\0" % len(content) + content, usedforsecurity=False).hexdigest()


class GitHubBackup:
    """Repository settings: repo = "owner/name", token = fine-grained token with Contents read/write."""

    def __init__(
        self, session: aiohttp.ClientSession, repo: str, token: str, branch: str = "main", path: str = "house_view"
    ):
        self._s = session
        self.repo = repo.strip().strip("/")
        self.branch = branch or "main"
        self.path = path.strip("/")
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "home-assistant-house-view",
        }

    def _file(self, key: str) -> str:
        return f"{self.path}/{key}.json" if self.path else f"{key}.json"

    async def _call(self, method: str, url: str, raw: bool = False, **kw: Any) -> tuple[int, Any]:
        headers = {**self._headers, "Accept": "application/vnd.github.raw"} if raw else self._headers
        try:
            async with self._s.request(method, url, headers=headers, timeout=TIMEOUT, **kw) as r:
                body = await r.read()
                status = r.status
        except (aiohttp.ClientError, TimeoutError) as err:
            raise GitHubError(f"GitHub unreachable: {err}") from err
        if raw and status == 200:
            return status, body
        try:
            data = json.loads(body) if body else None
        except ValueError:
            data = None
        if status >= 400 and status != 404:
            msg = data.get("message") if isinstance(data, dict) else body[:200].decode("utf8", "replace")
            raise GitHubError(f"GitHub {status}: {msg}", status)
        return status, data

    async def check(self) -> None:
        """The repository must exist, be reachable with the token, and be private (it holds the plan of the house)."""
        status, data = await self._call("GET", f"{API}/repos/{self.repo}")
        if status == 404:
            raise GitHubError("repository not found (or the token cannot see it)")
        if not data.get("private", False):
            raise GitHubError("the repository is public: use a private one")

    async def _remote_sha(self, key: str) -> str | None:
        status, data = await self._call(
            "GET", f"{API}/repos/{self.repo}/contents/{self._file(key)}", params={"ref": self.branch}
        )
        return data.get("sha") if status == 200 and isinstance(data, dict) else None

    async def _put(self, key: str, content: bytes, sha: str | None) -> None:
        body: dict[str, Any] = {
            "message": f"House View: update {key}",
            "content": base64.b64encode(content).decode("ascii"),
            "branch": self.branch,
        }
        if sha:
            body["sha"] = sha
        await self._call("PUT", f"{API}/repos/{self.repo}/contents/{self._file(key)}", json=body)

    async def backup(self, docs: dict[str, bytes]) -> dict[str, Any]:
        """
        Commit every changed document, one by one and each on its own:
        { written: keys committed, unchanged: keys already up to date, failed: { key: why } }.
        """
        written: list[str] = []
        unchanged: list[str] = []
        failed: dict[str, str] = {}
        for key, content in docs.items():
            try:
                sha = await self._remote_sha(key)
                if sha == blob_sha(content):
                    unchanged.append(key)
                    continue
                try:
                    await self._put(key, content, sha)
                except GitHubError as err:
                    if not err.conflict:
                        raise
                    await self._put(key, content, await self._remote_sha(key))
                written.append(key)
            except GitHubError as err:
                failed[key] = str(err)
        return {"written": written, "unchanged": unchanged, "failed": failed}

    async def restore(self, keys: tuple[str, ...]) -> dict[str, Any]:
        """Documents found in the repository (missing files are skipped)."""
        out: dict[str, Any] = {}
        for key in keys:
            status, body = await self._call(
                "GET", f"{API}/repos/{self.repo}/contents/{self._file(key)}", raw=True, params={"ref": self.branch}
            )
            if status == 200:
                try:
                    out[key] = json.loads(body)
                except ValueError as err:
                    raise GitHubError(f"{self._file(key)} is not valid JSON") from err
        return out
