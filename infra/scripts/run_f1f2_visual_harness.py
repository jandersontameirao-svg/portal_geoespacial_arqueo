#!/usr/bin/env python3
"""Finite real-component UI harness: synthetic APIs only, isolated network namespace.

Run as the regular sandbox user: python3 infra/scripts/run_f1f2_visual_harness.py
Requires existing node_modules, chromium, ip and passwordless sudo; installs nothing.
CDP framing is adapted from run_local_visual_harness.py (original is untouched).
Every invocation creates a new evidence attempt directory, including failed attempts.
"""
from __future__ import annotations

import base64
import datetime as dt
import errno
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/consolidation/evidence/f1f2-visual"
PORT, CDP_PORT = 4181, 9228
LOCAL_URL = f"http://127.0.0.1:{PORT}/f1f2-upload-harness.html"
SOURCE_PATHS = [
    "client/src/components/FileUpload.tsx", "client/src/components/RasterIngestionPanel.tsx",
    "shared/tiffUploadPolicy.ts", "client/src/f1f2UploadHarness.tsx",
    "client/f1f2-upload-harness.html", "vite.f1f2-harness.config.ts",
    "infra/scripts/run_f1f2_visual_harness.py",
]


def save(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def http_json(url):
    with urllib.request.urlopen(url, timeout=1) as response:
        return json.loads(response.read().decode())


def wait_http(url, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"Loopback server did not respond: {url}")


class CDP:
    def __init__(self, ws_url):
        parsed = urlparse(ws_url)
        self.sock = socket.create_connection((parsed.hostname, parsed.port), timeout=12)
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        target = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        self.sock.sendall((
            f"GET {target} HTTP/1.1\r\nHost: {parsed.hostname}:{parsed.port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Origin: http://127.0.0.1:{CDP_PORT}\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        headers = b""
        while b"\r\n\r\n" not in headers:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("CDP closed during handshake")
            headers += chunk
        if b" 101 " not in headers.split(b"\r\n", 1)[0]:
            raise RuntimeError(f"CDP upgrade failed: {headers!r}")
        self.counter = 0
        self.events = []

    def exact(self, length):
        data = b""
        while len(data) < length:
            chunk = self.sock.recv(length - len(data))
            if not chunk:
                raise RuntimeError("CDP closed during read")
            data += chunk
        return data

    def send(self, text):
        payload = text.encode()
        mask = secrets.token_bytes(4)
        size = len(payload)
        if size < 126:
            header = bytes([0x81, 0x80 | size])
        elif size < 65536:
            header = bytes([0x81, 0x80 | 126]) + struct.pack("!H", size)
        else:
            header = bytes([0x81, 0x80 | 127]) + struct.pack("!Q", size)
        self.sock.sendall(header + mask + bytes(v ^ mask[i % 4] for i, v in enumerate(payload)))

    def receive(self):
        first, second = self.exact(2)
        opcode, length = first & 15, second & 127
        if length == 126:
            length = struct.unpack("!H", self.exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.exact(8))[0]
        mask = self.exact(4) if second & 128 else b""
        payload = self.exact(length)
        if mask:
            payload = bytes(v ^ mask[i % 4] for i, v in enumerate(payload))
        if opcode == 8:
            raise RuntimeError("CDP socket closed")
        if opcode == 9:
            pong_mask = secrets.token_bytes(4)
            self.sock.sendall(bytes([0x8A, 0x80 | len(payload)]) + pong_mask + bytes(v ^ pong_mask[i % 4] for i, v in enumerate(payload)))
            return self.receive()
        if opcode != 1:
            return self.receive()
        return payload.decode()

    def call(self, method, params=None):
        self.counter += 1
        request_id = self.counter
        self.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.receive())
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})
            self.events.append(message)

    def evaluate(self, expression):
        result = self.call("Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True})
        if "exceptionDetails" in result:
            raise RuntimeError(f"JS exception: {result['exceptionDetails']}")
        return result.get("result", {}).get("value")

    def close(self):
        self.sock.close()


def wait_js(cdp, expression, timeout=12):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            value = cdp.evaluate(expression)
            if value:
                return value
        except RuntimeError as exc:
            last_error = str(exc)
        time.sleep(0.1)
    raise RuntimeError(f"Condition timeout: {expression}; lastError={last_error}")


def click(cdp, selector):
    box = cdp.evaluate("(() => { const e=document.querySelector(" + json.dumps(selector) + "); if(!e) throw Error('missing target'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()")
    for event in ["mousePressed", "mouseReleased"]:
        cdp.call("Input.dispatchMouseEvent", {"type": event, **box, "button": "left", "clickCount": 1})


def snapshot(cdp):
    return cdp.evaluate("""({
      inspection: window.__F1F2_HARNESS__,
      body: document.body.innerText,
      toasts: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(e=>({type:e.dataset.type,text:e.innerText})),
      mode: document.querySelector('[data-testid=tiff-upload-mode]')?.value,
      resources: performance.getEntriesByType('resource').map(e=>e.name),
      inputs: Array.from(document.querySelectorAll('input[type=file]')).map(e=>({accept:e.accept, files:Array.from(e.files||[]).map(f=>({name:f.name,type:f.type,size:f.size}))})),
      cookies: document.cookie,
      localStorageKeys: Object.keys(localStorage), sessionStorageKeys: Object.keys(sessionStorage)
    })""")


def inject_file(cdp, selector, filename, mime):
    # Actual DOM change event, browser File and DataTransfer; no handler or policy called directly.
    return cdp.evaluate("""(() => {
      const e = document.querySelector(SELECTOR);
      if(!e) throw new Error('Missing real file input');
      const f = new File([new Uint8Array([73,73,42,0,83,89,78,84,72,69,84,73,67])], FILENAME, {type:MIME,lastModified:1700000000000});
      const d = new DataTransfer(); d.items.add(f); e.files = d.files;
      const fixture={name:f.name,type:f.type,size:f.size,lastModified:f.lastModified,validGeoTiff:false};
      e.dispatchEvent(new Event('change',{bubbles:true})); return fixture;
    })()""".replace("SELECTOR", json.dumps(selector)).replace("FILENAME", json.dumps(filename)).replace("MIME", json.dumps(mime)))


def run_case(cdp, attempt, case):
    case_id = case["id"]
    print(f"CASE_START={case_id}", flush=True)
    cdp.call("Page.navigate", {"url": LOCAL_URL + "?case=" + case_id})
    wait_js(cdp, "window.__F1F2_HARNESS__?.caseId === " + json.dumps(case_id) + " && document.querySelector('[data-testid=tiff-upload-mode]') && document.body.innerText.includes('MOCK: serviço raster indisponível.')")
    # Let the shared availability query finish before changing controls.
    wait_js(cdp, "window.__F1F2_HARNESS__.calls.some(c=>c.path==='raster.ingestionAvailability' && c.response)")
    if case.get("available"):
        click(cdp, '[data-testid="mock-availability"]')
        wait_js(cdp, "document.body.innerText.includes('Serviço raster disponível.') && Boolean(document.querySelector('[data-testid=real-raster-panel] input[type=file]'))")
    if not case.get("rejectRaster", True):
        click(cdp, '[data-testid="mock-reject-raster"]')
    if case.get("mode") == "original":
        cdp.evaluate("(() => { const e=document.querySelector('[data-testid=tiff-upload-mode]'); e.value='original'; e.dispatchEvent(new Event('change',{bubbles:true})); })()")
        wait_js(cdp, "document.querySelector('[data-testid=tiff-upload-mode]').value === 'original'")
    before = snapshot(cdp)
    selector = '[data-testid="real-raster-panel"] input[type="file"]' if case.get("panel") else '[data-testid="real-file-upload"] input[type="file"]'
    fixture = inject_file(cdp, selector, case["filename"], case["mime"])
    expected = case["expect"]
    if expected == "blocked-unavailable":
        wait_js(cdp, "Array.from(document.querySelectorAll('[data-sonner-toast]')).some(e=>e.dataset.type==='error' && e.innerText.includes('guardar somente o original'))")
    elif expected == "blocked-mime":
        wait_js(cdp, "Array.from(document.querySelectorAll('[data-sonner-toast]')).some(e=>e.dataset.type==='error' && e.innerText.includes('Tipo de arquivo não permitido'))")
    elif expected == "raster-error":
        wait_js(cdp, "document.querySelector('[data-testid=real-file-upload]').innerText.includes('✗ MOCK_RASTER_REJECTED')")
        wait_js(cdp, "Array.from(document.querySelectorAll('[data-sonner-toast]')).some(e=>e.dataset.type==='error' && e.innerText.includes('MOCK_RASTER_REJECTED'))")
    else:
        wait_js(cdp, "Array.from(document.querySelectorAll('[data-sonner-toast]')).some(e=>e.dataset.type==='success')")
    immediate = snapshot(cdp)
    # Observe beyond the component's delayed cleanup: absence assertions are bounded to this window.
    time.sleep(2.6 if expected in ["raster-error", "blocked-unavailable", "blocked-mime"] else 0.25)
    after = snapshot(cdp)
    calls = after["inspection"]["calls"]
    mutations = [c for c in calls if c["type"] == "mutation"]
    generic = [c for c in mutations if c["path"] == "files.upload"]
    raster = [c for c in mutations if c["path"] == "raster.ingestGeoTiff"]
    assertions = []

    def check(label, condition):
        assertions.append({"assertion": label, "passed": bool(condition)})

    check("real component DOM mounted", bool(before["mode"]))
    check("browser File preserves name/type", fixture["name"] == case["filename"] and fixture["type"] == case["mime"])
    check("no cookies/localStorage/sessionStorage", after["cookies"] == "" and not after["localStorageKeys"] and not after["sessionStorageKeys"])
    check("all resource entries loopback", all(url.startswith(f"http://127.0.0.1:{PORT}/") for url in after["resources"]))
    if expected.startswith("blocked"):
        check("blocked before any mutation", len(mutations) == 0)
        check("error toast visible", any(t["type"] == "error" for t in immediate["toasts"]))
        check("no success toast", not any(t["type"] == "success" for t in immediate["toasts"] + after["toasts"]))
    elif expected == "original":
        check("only files.upload mutation", len(generic) == 1 and len(raster) == 0 and len(mutations) == 1)
        payload = generic[0]["input"] if generic else {}
        check("original normalized image/tiff and category image", payload.get("mimeType") == "image/tiff" and payload.get("category") == "image")
        check("original filename preserved", payload.get("filename") == case["filename"])
        check("original-only success toast", any(t["type"] == "success" and "original armazenado; raster/COG não processado" in t["text"] for t in immediate["toasts"]))
    else:
        check("only raster mutation; never generic fallback", len(raster) == 1 and len(generic) == 0 and len(mutations) == 1)
        payload = raster[0]["input"] if raster else {}
        check("short raster name a.tif valid >=2", payload.get("name") == "a.tif" and 2 <= len(payload.get("name", "")) <= 255)
        check("filename not renamed", payload.get("filename") == "a.tif")
        check("effective raster MIME image/tiff", payload.get("mimeType") == "image/tiff")
        if expected == "raster-error":
            check("mock rejection captured", bool(raster) and raster[0]["outcome"] == "mock-error")
            check("error displayed in real component", "✗ MOCK_RASTER_REJECTED" in immediate["body"])
            check("no success DOM or toast, including delayed window", "✓ Upload concluído" not in immediate["body"] + after["body"] and not any(t["type"] == "success" for t in immediate["toasts"] + after["toasts"]))
        else:
            check("mock success captured (not real ingestion)", bool(raster) and raster[0]["outcome"] == "mock-success")
            check("success toast visible", any(t["type"] == "success" for t in immediate["toasts"]))
    payloads = [c["input"] for c in mutations]
    if payloads:
        check("synthetic bytes passed as base64", all(p.get("fileData") == base64.b64encode(bytes([73,73,42,0,83,89,78,84,72,69,84,73,67])).decode() for p in payloads))
    result = {"id": case_id, "specification": case, "fixture": fixture, "before": before, "immediate": immediate, "afterObservationWindow": after, "assertions": assertions, "passed": all(a["passed"] for a in assertions)}
    save(attempt / f"{case_id}.json", result)
    screenshot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})["data"]
    screenshot_path = attempt / f"{case_id}.png"
    screenshot_path.write_bytes(base64.b64decode(screenshot))
    result["screenshot"] = screenshot_path.name
    result["screenshotSha256"] = hashlib.sha256(screenshot_path.read_bytes()).hexdigest()
    save(attempt / f"{case_id}.json", result)
    print(f"CASE_{'PASS' if result['passed'] else 'FAIL'}={case_id}; assertions={len(assertions)}", flush=True)
    return result


def terminate_owned(process):
    if not process:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def inside(attempt):
    os.umask(0o022)
    report = {
        "scope": "offline-real-react-components-with-in-memory-trpc-link",
        "url": LOCAL_URL, "status": "running", "cases": [],
        "mockedApis": ["raster.ingestionAvailability", "files.upload", "raster.ingestGeoTiff"],
        "authentication": "App not imported or mounted; no OAuth, auth provider or bypass; no user/token/cookie",
        "fixtures": "synthetic browser File bytes, NOT valid GeoTIFF; never sent to storage/backend",
        "limits": ["Not storage or DB persistence", "Not real server validation, scanner or authorization", "Not OAuth", "Not COG/raster processing or tiles", "Not stage/prod", "Absence assertions bounded to 2.6 seconds after observed error", "onUploadComplete callback is not treated as success: real FileUpload also invokes it after failed mutation cleanup"],
        "sourcesSha256Before": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCE_PATHS},
    }
    vite = chrome = cdp = None
    handles = []
    try:
        network = {"namespace": os.readlink("/proc/self/ns/net"), "interfaces": json.loads(subprocess.check_output(["ip", "-j", "addr", "show"])), "routesIPv4": json.loads(subprocess.check_output(["ip", "-j", "route", "show"])), "routesIPv6": json.loads(subprocess.check_output(["ip", "-j", "-6", "route", "show"]))}
        probe = socket.socket()
        probe.settimeout(1)
        network["externalDirectProbe"] = {"destination": "1.1.1.1:443", "errno": probe.connect_ex(("1.1.1.1", 443))}
        probe.close()
        report["network"] = network
        if len(network["interfaces"]) != 1 or network["interfaces"][0]["ifname"] != "lo" or network["routesIPv4"] or network["routesIPv6"] or network["externalDirectProbe"]["errno"] != errno.ENETUNREACH:
            raise RuntimeError("Network namespace does not satisfy loopback-only/no-route contract")
        report["environment"] = {k: os.environ.get(k) for k in ["VITE_APP_ID", "VITE_API_URL", "VITE_OAUTH_PORTAL_URL", "VITE_OAUTH_SERVER_URL", "VITE_APP_URL", "VITE_FRONTEND_FORGE_API_URL"]}
        with tempfile.TemporaryDirectory(prefix="atena-f1f2-visual-") as temp:
            temp_path = Path(temp)
            env = {**os.environ, "F1F2_VITE_CACHE_DIR": str(temp_path / "vite-cache"), "XDG_CACHE_HOME": str(temp_path / "xdg-cache"), "XDG_CONFIG_HOME": str(temp_path / "xdg-config")}
            for name in ["vite.log", "chromium.log"]:
                handles.append((attempt / name).open("w"))
            vite = subprocess.Popen([shutil.which("node"), str(ROOT / "node_modules/vite/bin/vite.js"), "--config", "vite.f1f2-harness.config.ts", "--configLoader", "runner"], cwd=ROOT, env=env, stdout=handles[0], stderr=subprocess.STDOUT, start_new_session=True)
            try:
                wait_http(LOCAL_URL)
                chrome = subprocess.Popen([
                    "/usr/bin/chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
                    "--disable-domain-reliability", "--disable-sync", "--metrics-recording-only", "--disable-client-side-phishing-detection",
                    "--disable-features=OptimizationHints,MediaRouter", "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1",
                    "--remote-debugging-address=127.0.0.1", f"--remote-debugging-port={CDP_PORT}",
                    f"--remote-allow-origins=http://127.0.0.1:{CDP_PORT}",
                    f"--user-data-dir={temp_path / 'chrome-profile'}", "--window-size=1440,1300", "about:blank",
                ], cwd=ROOT, env=env, stdout=handles[1], stderr=subprocess.STDOUT, start_new_session=True)
                wait_http(f"http://127.0.0.1:{CDP_PORT}/json/list")
                target = next(t for t in http_json(f"http://127.0.0.1:{CDP_PORT}/json/list") if t.get("type") == "page")
                cdp = CDP(target["webSocketDebuggerUrl"])
                for domain in ["Page", "Runtime", "Network", "Log"]:
                    cdp.call(domain + ".enable")
                report["network"]["listeners"] = subprocess.check_output(["ss", "-lntp"], text=True)
                cases = [
                    {"id": "01-raster-unavailable", "filename": "blocked.tif", "mime": "image/tiff", "expect": "blocked-unavailable"},
                    {"id": "02-original-tiff", "mode": "original", "filename": "original.tif", "mime": "image/tiff", "expect": "original"},
                    {"id": "03-original-image-geotiff", "mode": "original", "filename": "alternate-image.tif", "mime": "image/geotiff", "expect": "original"},
                    {"id": "04-original-application-geotiff", "mode": "original", "filename": "alternate-application.tiff", "mime": "application/geotiff", "expect": "original"},
                    {"id": "05-original-empty-mime", "mode": "original", "filename": "empty.tif", "mime": "", "expect": "original"},
                    {"id": "06-conflicting-mime-original", "mode": "original", "filename": "conflict.tif", "mime": "application/x-msdownload", "expect": "blocked-mime"},
                    {"id": "07-conflicting-mime-raster", "available": True, "filename": "conflict.tif", "mime": "application/x-msdownload", "expect": "blocked-mime"},
                    {"id": "08-short-raster-name", "available": True, "rejectRaster": False, "filename": "a.tif", "mime": "image/tiff", "expect": "raster-success"},
                    {"id": "09-raster-rejection-no-fallback", "available": True, "filename": "a.tif", "mime": "image/tiff", "expect": "raster-error"},
                    {"id": "10-panel-short-empty-mime", "available": True, "rejectRaster": False, "panel": True, "filename": "a.tif", "mime": "", "expect": "raster-success"},
                ]
                for case in cases:
                    try:
                        report["cases"].append(run_case(cdp, attempt, case))
                    except Exception as exc:
                        failed = {"id": case["id"], "passed": False, "error": str(exc), "assertions": []}
                        try:
                            failed["diagnostic"] = snapshot(cdp)
                            screenshot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})["data"]
                            (attempt / (case["id"] + "-failed.png")).write_bytes(base64.b64decode(screenshot))
                        except Exception as diagnostic_exc:
                            failed["diagnosticError"] = str(diagnostic_exc)
                        save(attempt / (case["id"] + "-failed.json"), failed)
                        report["cases"].append(failed)
                        print(f"CASE_FAIL={case['id']}: {exc}", flush=True)
                report["network"]["observedRequestUrls"] = sorted({e["params"]["request"]["url"] for e in cdp.events if e.get("method") == "Network.requestWillBeSent"})
                report["network"]["externalObservedRequests"] = [u for u in report["network"]["observedRequestUrls"] if not u.startswith(f"http://127.0.0.1:{PORT}/") and not u.startswith("data:")]
                report["consoleExceptions"] = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
                save(attempt / "cdp-events.json", cdp.events)
                report["status"] = "passed" if all(c["passed"] for c in report["cases"]) and not report["network"]["externalObservedRequests"] and not report["consoleExceptions"] else "failed"
            finally:
                if cdp:
                    cdp.close()
                terminate_owned(chrome)
                terminate_owned(vite)
                report["cleanup"] = {"chromiumStopped": chrome is None or chrome.poll() is not None, "viteStopped": vite is None or vite.poll() is not None, "temporaryDirectory": temp, "temporaryDirectoryRemoval": "by TemporaryDirectory context"}
        report["cleanup"]["temporaryDirectoryRemoved"] = not Path(report["cleanup"]["temporaryDirectory"]).exists()
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = str(exc)
        report["traceback"] = traceback.format_exc()
        print(report["traceback"], flush=True)
    finally:
        for handle in handles:
            handle.close()
        report["sourcesSha256After"] = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCE_PATHS}
        report["sourceFilesStableDuringRun"] = report["sourcesSha256Before"] == report["sourcesSha256After"]
        report["counts"] = {"casesExecuted": len(report["cases"]), "casesPassed": sum(c["passed"] for c in report["cases"]), "casesFailed": sum(not c["passed"] for c in report["cases"]), "assertionsExecuted": sum(len(c["assertions"]) for c in report["cases"]), "assertionsPassed": sum(a["passed"] for c in report["cases"] for a in c["assertions"])}
        save(attempt / "report.json", report)
        print("F1F2_VISUAL_HARNESS=" + report["status"].upper(), flush=True)
        print("REPORT_DIR=" + str(attempt), flush=True)
    return 0 if report["status"] == "passed" else 1


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--inside-offline-namespace":
        return inside(Path(sys.argv[2]))
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    attempt = EVIDENCE / (dt.datetime.now(dt.timezone.utc).strftime("attempt-%Y%m%dT%H%M%S.%fZ") + "-" + secrets.token_hex(3))
    attempt.mkdir()
    # No inherited credentials, proxy, app environment or dotenv. Vite envDir is false.
    clean_env = {
        "HOME": "/tmp", "PATH": str(Path(shutil.which("node")).resolve().parent) + ":/usr/bin:/bin:/usr/sbin:/sbin",
        "LANG": "C.UTF-8", "NO_PROXY": "*", "no_proxy": "*", "VITE_APP_ID": "synthetic",
        "VITE_API_URL": "https://api.invalid", "VITE_APP_URL": "https://app.invalid",
        "VITE_OAUTH_PORTAL_URL": "https://oauth.invalid", "VITE_OAUTH_SERVER_URL": "https://oauth-server.invalid",
        "VITE_FRONTEND_FORGE_API_URL": "https://forge.invalid",
    }
    command = ["sudo", "-n", "unshare", "--net", "/bin/sh", "-ec", 'ip link set lo up; exec /usr/bin/env -i "$@"', "f1f2-offline", *[f"{k}={v}" for k, v in clean_env.items()], sys.executable, str(Path(__file__).resolve()), "--inside-offline-namespace", str(attempt)]
    save(attempt / "launch.json", {"command": command, "cleanEnvironmentKeys": list(clean_env), "finiteTimeoutSeconds": 240, "parentNetworkNamespace": os.readlink("/proc/self/ns/net")})
    print("F1F2_OFFLINE_ATTEMPT=" + str(attempt), flush=True)
    with (attempt / "runner.log").open("w") as log:
        try:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=240)
            exit_code = result.returncode
        except subprocess.TimeoutExpired:
            exit_code = 124
            save(attempt / "timeout.json", {"error": "finite harness timeout", "seconds": 240})
    # The namespace runner owns all child groups and cleans them in finally; root-created evidence becomes user-owned.
    subprocess.run(["sudo", "-n", "chown", "-R", f"{os.getuid()}:{os.getgid()}", str(attempt)], check=False)
    print((attempt / "runner.log").read_text(), end="", flush=True)
    save(attempt / "exit.json", {"exitCode": exit_code, "finishedUTC": dt.datetime.now(dt.timezone.utc).isoformat()})
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
