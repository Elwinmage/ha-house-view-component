"""Tiny fake of the house_view HTTP API + static files, to test the card without Home Assistant.
Usage: python3 test/harness/server.py [port]   then open http://localhost:PORT/card/test/harness/index.html"""

import json
import pathlib
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).parents[3]  # repository root
DB = {}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def _key(self):
        p = self.path.split("?")[0]
        return p[len("/api/house_view/") :] if p.startswith("/api/house_view/") else None

    def _send(self, code, body=b"{}"):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        k = self._key()
        if k is None:
            return super().do_GET()
        if k == "info":
            return self._send(
                200,
                json.dumps(
                    {"has_scene": "scene" in DB, "has_terrain": "terrain" in DB, "has_edits": "edits" in DB}
                ).encode(),
            )
        return self._send(200, DB[k]) if k in DB else self._send(404)

    def do_POST(self):
        k = self._key()
        DB[k] = self.rfile.read(int(self.headers["Content-Length"]))
        self._send(200)

    def do_DELETE(self):
        DB.pop(self._key(), None)
        self._send(200)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
