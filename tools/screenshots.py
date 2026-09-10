"""Скриншоты страницы через установленный Chrome (Playwright, channel=chrome).

python tools/screenshots.py <папка-для-png> [пароль-от-образца]

Поднимает http.server на docs/, снимает: запечатанное состояние на телефоне и на
десктопе, открытое состояние (#open) до и после ввода пароля, неверный пароль.
"""

import http.server
import os
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
PORT = 8765


def serve():
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=str(DOCS), **kw)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    out = Path(sys.argv[1]).resolve()
    password = sys.argv[2] if len(sys.argv) > 2 else None
    out.mkdir(parents=True, exist_ok=True)
    httpd = serve()
    base = f"http://127.0.0.1:{PORT}/index.html"
    shots = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)

        def snap(name, width, height, url, actions=None, form_visible=None):
            ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2, locale="ru-RU")
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(url)
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(1500)
            if actions:
                actions(page)
            if form_visible is not None and page.is_visible("#unlock") != form_visible:
                errors.append(f"форма пароля {'видна' if not form_visible else 'не видна'}, а должна быть наоборот")
            path = out / f"{name}.png"
            page.screenshot(path=str(path), full_page=True)
            shots.append((name, path, errors))
            ctx.close()

        snap("sealed-phone", 390, 844, base, form_visible=False)
        snap("sealed-desktop", 1280, 900, base, form_visible=False)
        snap("open-form-phone", 390, 844, base + "#open", form_visible=True)

        def wrong(page):
            page.fill("#vault-password", "wrong-password")
            page.click("#unlock-btn")
            page.wait_for_selector("#unlock-msg.is-error", timeout=30000)

        snap("open-wrong-password", 390, 844, base + "#open", wrong, form_visible=True)

        if password:
            def right(page):
                page.fill("#vault-password", password)
                page.click("#unlock-btn")
                page.wait_for_selector(".gallery img", timeout=60000)
                page.wait_for_function("document.querySelectorAll('.gallery img').length >= 6", timeout=60000)
                page.wait_for_timeout(1500)

            snap("open-gallery-phone", 390, 844, base + "#open", right, form_visible=False)

    httpd.shutdown()
    bad = 0
    for name, path, errors in shots:
        bad += len(errors)
        print(f"{name}: {path} ({path.stat().st_size // 1024} KiB), замечаний: {len(errors)}")
        for e in errors:
            print("   ", e)
    print(f"снимков {len(shots)}, замечаний всего {bad}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
