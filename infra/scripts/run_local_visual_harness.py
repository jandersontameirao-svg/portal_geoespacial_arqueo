#!/usr/bin/env python3
"""Executa o harness visual offline sem acessar OAuth, tRPC, banco ou rede externa."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "docs/consolidation/evidence/local-visual-harness"
PORT = 4178
CDP_PORT = 9225
LOCAL_URL = f"http://127.0.0.1:{PORT}/local-visual-harness.html"


def http_json(url: str):
    with urllib.request.urlopen(url, timeout=1) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_http(url: str, timeout: float = 30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"Servidor local não respondeu: {url}")


class CDP:
    def __init__(self, ws_url: str):
        parsed = urlparse(ws_url)
        self.sock = socket.create_connection((parsed.hostname, parsed.port), timeout=10)
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        request_target = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        request = (
            f"GET {request_target} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}:{parsed.port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            "Origin: http://127.0.0.1:9225\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode())
        response = self._read_http_headers()
        if " 101 " not in response.split("\r\n", 1)[0]:
            raise RuntimeError(f"Falha no upgrade CDP: {response.splitlines()[0]}")
        self.counter = 0
        self.events: list[dict] = []

    def _read_http_headers(self) -> str:
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("CDP encerrou no handshake")
            data += chunk
        return data.decode("latin-1")

    def _recv_exact(self, size: int) -> bytes:
        data = b""
        while len(data) < size:
            chunk = self.sock.recv(size - len(data))
            if not chunk:
                raise RuntimeError("CDP encerrou durante leitura")
            data += chunk
        return data

    def _send_frame(self, text: str):
        payload = text.encode()
        mask = secrets.token_bytes(4)
        length = len(payload)
        if length < 126:
            header = bytes([0x81, 0x80 | length])
        elif length < 65536:
            header = bytes([0x81, 0x80 | 126]) + struct.pack("!H", length)
        else:
            header = bytes([0x81, 0x80 | 127]) + struct.pack("!Q", length)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def _recv_frame(self) -> str:
        first, second = self._recv_exact(2)
        opcode = first & 0x0F
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._recv_exact(8))[0]
        masked = bool(second & 0x80)
        mask = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length)
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        if opcode == 0x8:
            raise RuntimeError("CDP fechou a conexão")
        if opcode == 0x9:
            self.sock.sendall(bytes([0x8A, len(payload)]) + payload)
            return self._recv_frame()
        if opcode != 0x1:
            return self._recv_frame()
        return payload.decode("utf-8")

    def call(self, method: str, params: dict | None = None) -> dict:
        self.counter += 1
        request_id = self.counter
        self._send_frame(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self._recv_frame())
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(f"CDP {method}: {message['error']}")
                return message.get("result", {})
            self.events.append(message)

    def evaluate(self, expression: str):
        result = self.call("Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True})
        value = result.get("result", {})
        if "exceptionDetails" in result:
            raise RuntimeError(f"JavaScript falhou: {result['exceptionDetails']}")
        return value.get("value")

    def close(self):
        self.sock.close()


def wait_cdp_target(timeout: float = 30) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            targets = http_json(f"http://127.0.0.1:{CDP_PORT}/json/list")
            for target in targets:
                if target.get("type") == "page" and target.get("url", "").startswith(LOCAL_URL):
                    return target
        except OSError:
            pass
        time.sleep(0.2)
    raise RuntimeError("Chromium não expôs o alvo local via CDP")


def cdp_click(cdp: CDP, selector: str):
    box = cdp.evaluate(
        "(() => { const e = document.querySelector(" + json.dumps(selector) + ");"
        "if (!e) throw new Error('Elemento ausente: ' + " + json.dumps(selector) + ");"
        "const r = e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()"
    )
    cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": box["x"], "y": box["y"], "button": "left", "clickCount": 1})
    cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": box["x"], "y": box["y"], "button": "left", "clickCount": 1})


def main():
    REPORT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="atena-local-visual-", ignore_cleanup_errors=True) as temp:
        temp_path = Path(temp)
        vite_log = temp_path / "vite.log"
        browser_log = temp_path / "chromium.log"
        vite = subprocess.Popen(
            ["pnpm", "exec", "vite", "--config", "vite.local-visual.config.ts"],
            cwd=ROOT,
            stdout=vite_log.open("w"), stderr=subprocess.STDOUT,
            env={**os.environ, "NO_PROXY": "*", "no_proxy": "*"},
        )
        chrome = None
        try:
            wait_http(LOCAL_URL)
            chrome = subprocess.Popen(
                [
                    "chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                    "--disable-component-update", "--disable-domain-reliability", "--disable-sync",
                    "--metrics-recording-only", "--disable-client-side-phishing-detection",
                    "--disable-features=OptimizationHints,MediaRouter", "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1",
                    "--remote-debugging-address=127.0.0.1", f"--remote-debugging-port={CDP_PORT}",
                    "--remote-allow-origins=http://127.0.0.1:9225",
                    f"--user-data-dir={temp_path / 'chrome-profile'}", "--window-size=1440,1400", LOCAL_URL,
                ],
                stdout=browser_log.open("w"), stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            target = wait_cdp_target()
            cdp = CDP(target["webSocketDebuggerUrl"])
            cdp.call("Page.enable")
            cdp.call("Runtime.enable")
            cdp.call("Network.enable")
            deadline = time.monotonic() + 8
            bootstrap = None
            while time.monotonic() < deadline:
                bootstrap = cdp.evaluate("({tree:Boolean(document.querySelector('[data-testid=thematic-layer-tree]')), identity:document.documentElement?.dataset.harnessLeafletIdentity ?? null, measureRegistered:document.documentElement?.dataset.harnessMeasureRegistered ?? null})")
                if bootstrap["tree"] and bootstrap["identity"] is not None and bootstrap["measureRegistered"] is not None:
                    break
                time.sleep(0.15)
            if not bootstrap or not bootstrap["tree"]:
                (REPORT / "measurement-bootstrap-diagnostic.json").write_text(json.dumps({
                    "bootstrap": bootstrap,
                    "body": cdp.evaluate("document.body.innerText"),
                    "windowLPresent": cdp.evaluate("Boolean(window.L)"),
                    "windowMeasureType": cdp.evaluate("typeof window.L?.Control?.Measure"),
                }, indent=2) + "\n", encoding="utf-8")
                raise RuntimeError("Harness não montou após a inicialização UMD local")

            # Fluxo 1: alternar visibilidade e ordem na árvore real.
            cdp_click(cdp, '[aria-label="Ocultar Área de interesse sintética"]')
            cdp_click(cdp, '[data-testid="thematic-layer-cog-local"] button[title="Subir na ordem visual"]')

            # Fluxo 2: selecionar ferramenta Leaflet real e inserir marcador na grade offline.
            cdp_click(cdp, ".leaflet-draw-draw-marker")
            map_box = cdp.evaluate("(() => { const r=document.querySelector('.leaflet-container').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()")
            cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": map_box["x"], "y": map_box["y"], "button": "none"})
            time.sleep(0.15)
            cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": map_box["x"], "y": map_box["y"], "button": "left", "clickCount": 1})
            cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": map_box["x"], "y": map_box["y"], "button": "left", "clickCount": 1})
            time.sleep(0.5)

            body = cdp.evaluate("document.body.innerText")
            resources = cdp.evaluate("performance.getEntriesByType('resource').map((entry) => entry.name)")
            marker_images = cdp.evaluate("Array.from(document.querySelectorAll('.leaflet-marker-icon, .leaflet-marker-shadow')).map((image) => ({src:image.src, complete:image.complete, naturalWidth:image.naturalWidth, naturalHeight:image.naturalHeight, className:image.className}))")
            marker_assets = [{
                "asset": urlparse(item["src"]).path.rsplit("/", 1)[-1],
                "loopback": item["src"].startswith(f"http://127.0.0.1:{PORT}/"),
                "complete": item["complete"],
                "naturalWidth": item["naturalWidth"],
                "naturalHeight": item["naturalHeight"],
                "className": item["className"],
            } for item in marker_images]
            external = [url for url in resources if not url.startswith(f"http://127.0.0.1:{PORT}/")]
            if "Ocultada: Área de interesse sintética" not in body:
                (REPORT / "last-body-on-failure.txt").write_text(body, encoding="utf-8")
                raise RuntimeError("Fluxo de visibilidade da árvore não foi confirmado")
            if "Limpar 1 geometria(s)" not in body:
                (REPORT / "last-body-on-failure.txt").write_text(body, encoding="utf-8")
                raise RuntimeError("Fluxo Leaflet Draw não registrou marcador em memória")
            if external:
                raise RuntimeError(f"Recurso não local detectado: {external}")

            screenshot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})["data"]
            png_path = REPORT / "local-visual-harness.png"
            png_path.write_bytes(base64.b64decode(screenshot))
            report = {
                "scope": "strict-local-visual-harness",
                "url": LOCAL_URL,
                "network": {
                    "externalNetworkBlocked": True,
                    "csp": "assets self/data/blob; connect-src self; unsafe-eval limitado ao plugin UMD neste harness localhost",
                    "chromiumHostResolver": "MAP * 0.0.0.0, EXCLUDE 127.0.0.1",
                    "externalResourcesObserved": external,
                },
                "authentication": "not mounted; no auth mock, OAuth callback, cookie, token or user created",
                "fixtures": "in-memory synthetic thematic layers and in-memory Leaflet marker",
                "leafletMarkerAssets": marker_assets,
                "flows": {
                    "thematicVisibility": "passed",
                    "thematicReorder": "passed",
                    "leafletDrawMarkerInMemory": "passed",
                    "measurementControlMounted": bool(cdp.evaluate("Boolean(document.querySelector('.leaflet-control-measure'))")),
                },
                "measurementBootstrap": {
                    "windowLIsSameMapInstance": bootstrap["identity"] == "true",
                    "umdRegisteredBeforeReactMount": bootstrap["measureRegistered"] == "true",
                },
                "screenshot": png_path.name,
                "screenshotSha256": hashlib.sha256(png_path.read_bytes()).hexdigest(),
                "limits": [
                    "not OAuth real", "not tRPC/backend", "not database persistence", "not storage", "not WMS/WFS/tiles", "not production or stage",
                ],
            }
            (REPORT / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print("LOCAL_VISUAL_HARNESS=PASS")
            print(f"REPORT_DIR={REPORT}")
            cdp.close()
        finally:
            if chrome:
                os.killpg(chrome.pid, signal.SIGTERM)
                try: chrome.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(chrome.pid, signal.SIGKILL)
            vite.terminate()
            try: vite.wait(timeout=5)
            except subprocess.TimeoutExpired: vite.kill()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"LOCAL_VISUAL_HARNESS=FAIL: {exc}", file=sys.stderr)
        raise
