"""Manual backup / restore of the House View documents to a private GitHub repository (REST "contents" API).

Each document is one file `<path>/<key>.json` on the configured branch. A backup only commits the files whose content
changed (same git blob sha = nothing to do); a restore reads the raw files back and validates them before storing.
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
    """GitHub answered with an error (message shown to the user)."""


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
            raise GitHubError(f"GitHub {status}: {msg}")
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

    async def backup(self, docs: dict[str, bytes]) -> list[str]:
        """Commit every changed document; returns the keys that were written."""
        written = []
        for key, content in docs.items():
            sha = await self._remote_sha(key)
            if sha == blob_sha(content):
                continue
            body: dict[str, Any] = {
                "message": f"House View: update {key}",
                "content": base64.b64encode(content).decode("ascii"),
                "branch": self.branch,
            }
            if sha:
                body["sha"] = sha
            await self._call("PUT", f"{API}/repos/{self.repo}/contents/{self._file(key)}", json=body)
            written.append(key)
        return written

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
