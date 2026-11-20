"""Tiny fake of the house_view HTTP API + static files, to test the card without Home Assistant.
Usage: python3 test/harness/server.py [port] [edit password]
then open http://localhost:PORT/card/test/harness/index.html"""

import json
import pathlib
import secrets
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).parents[3]  # repository root
HOMES = {"": {}}  # home id -> documents ("" = the first home); "demo" once the demo is loaded
DEMO = ROOT / "custom_components" / "house_view" / "demo"
JOBS = {}  # documents of a home -> simulated terrain fetch of the demo: {"t0", "center"}
STEPS = (("locate", 1.0), ("dtm", 2.5), ("dsm", 2.0), ("vectors", 1.5))
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else ""  # edit lock, as set in the options of the integration
TOKENS = set()
# built-in snapshots of the house catalog: what the integration answers to `house_view/catalog` before any download
BUILTIN = {
    "trees": ("catalog_builtin", "tree.json"),
    "objects": ("catalog_builtin_objects", "object.json"),
    "fish": ("catalog_builtin_fish", "fish.json"),
}


def catalog(section):
    """The answer of the websocket command `house_view/catalog`, from the built-in snapshot of a section."""
    folder, descriptor = BUILTIN[section]
    base = ROOT / "custom_components" / "house_view" / folder / "items"
    items = {}
    for entry in sorted(base.iterdir()) if base.is_dir() else []:
        url = f"/custom_components/house_view/{folder}/items/{entry.name}"
        items[entry.name] = json.loads((entry / descriptor).read_text(encoding="utf-8")) | {
            "source": "builtin",
            "image": f"{url}/image.webp" if (entry / "image.webp").is_file() else None,
            "thumb": f"{url}/thumb.webp" if (entry / "thumb.webp").is_file() else None,
        }
    return {"section": section, "format": 1, "version": None, "updating": False, "data": {"items": items}}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def _key(self):
        p = self.path.split("?")[0]
        return p[len("/api/house_view/") :] if p.startswith("/api/house_view/") else None

    @property
    def _db(self):
        """Documents of the home named by `?home=` (the first home without it)."""
        q = self.path.split("?", 1)[1] if "?" in self.path else ""
        home = dict(kv.split("=", 1) for kv in q.split("&") if "=" in kv).get("home", "")
        return HOMES.setdefault(home, {})

    def _send(self, code, body=b"{}"):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _locked(self):
        return bool(PASSWORD) and self.headers.get("X-House-View-Unlock") not in TOKENS

    def do_GET(self):
        k = self._key()
        if self.path.startswith("/harness/catalog/"):
            section = self.path.rsplit("/", 1)[1]
            return self._send(200, json.dumps(catalog(section)).encode()) if section in BUILTIN else self._send(404)
        if k is None:
            return super().do_GET()
        if k == "unlock":
            return self._send(200, json.dumps({"locked": bool(PASSWORD), "unlocked": not self._locked()}).encode())
        if k == "demo":
            body = (DEMO / "demo-maison.sh3d").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        DB = self._db
        if k == "fetch":
            job = JOBS.get(id(DB))
            if not job:
                return self._send(200, b'{"state": "idle"}')
            t = time.time() - job["t0"]
            for step, sec in STEPS:
                if t < sec:
                    return self._send(200, json.dumps({"state": "running", "step": step}).encode())
                t -= sec
            terrain = json.loads((DEMO / "demo-terrain.json").read_text())
            terrain["center"] = job["center"]
            DB["terrain"] = json.dumps(terrain).encode()
            JOBS.pop(id(DB))
            return self._send(200, b'{"state": "done", "message": "demo"}')
        if k == "info":
            demo = DB is HOMES.get("demo")
            return self._send(
                200,
                json.dumps(
                    {
                        "has_scene": "scene" in DB,
                        "has_terrain": "terrain" in DB,
                        "has_edits": "edits" in DB,
                        "has_ortho": "ortho" in DB,
                        "github": None,
                        "locked": bool(PASSWORD),
                        "demo": demo,
                        **({"latitude": 45.0, "longitude": 2.0} if demo else {}),
                    }
                ).encode(),
            )
        return self._send(200, DB[k]) if k in DB else self._send(404)

    def do_POST(self):
        k = self._key()
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if k == "unlock":
            if PASSWORD and json.loads(body).get("password") != PASSWORD:
                return self._send(403, b'{"message": "Wrong password"}')
            token = secrets.token_urlsafe(8) if PASSWORD else None
            TOKENS.add(token)
            reply = {"ok": True, "locked": bool(PASSWORD), "token": token, "ttl": 600}
            return self._send(200, json.dumps(reply).encode())
        if k == "demo":
            HOMES["demo"] = {
                "edits": (DEMO / "demo-edits.json").read_bytes(),
            }
            return self._send(200, b'{"home": "demo"}')
        if self._locked():
            return self._send(423, b'{"message": "Editing is locked"}')
        if k == "fetch":
            JOBS[id(self._db)] = {"t0": time.time(), "center": json.loads(body)["center"]}
            return self._send(202, b'{"state": "running", "step": "start"}')
        self._db[k] = body
        self._send(200)

    def do_DELETE(self):
        k = self._key()
        if k == "unlock":
            TOKENS.discard(self.headers.get("X-House-View-Unlock"))
        elif self._locked():
            return self._send(423, b'{"message": "Editing is locked"}')
        else:
            self._db.pop(k, None)
        self._send(200)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
