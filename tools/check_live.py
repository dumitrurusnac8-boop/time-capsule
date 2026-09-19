# -*- coding: utf-8 -*-
"""Проверка ЖИВОГО адреса капсулы, а не локальной копии.

python tools/check_live.py <адрес> [пароль-от-хранилища]

Смотрит коды ответа и размеры файлов, потом открывает страницу настоящим
Chrome: считает таймеры, проверяет, что видео реально играет, и что форма
пароля спрятана до срока. С паролем дополнительно открывает хранилище.
"""

import sys
import urllib.request

from playwright.sync_api import sync_playwright


def head(url):
    req = urllib.request.Request(url, method="GET", headers={"Range": "bytes=0-0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers.get("Content-Range") or r.headers.get("Content-Length")
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:60]


def main():
    base = sys.argv[1].rstrip("/") + "/"
    password = sys.argv[2] if len(sys.argv) > 2 else None
    problems = []

    print("=== файлы на сервере")
    for name in ["", "style.css", "capsule.js", "config.js", "video.mp4",
                 "poster.jpg", "vault/vault.json", "vault/manifest.bin"]:
        status, info = head(base + name)
        shown = name or "index.html"
        print("  %-22s %s  %s" % (shown, status, info))
        if status not in (200, 206):
            problems.append("%s отдаёт %s" % (shown, status))

    print("\n=== страница в браузере")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, locale="ru-RU")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(base, wait_until="load", timeout=60000)
        page.wait_for_timeout(2500)

        title = page.title()
        clock = page.inner_text("#clock").replace("\n", " ")
        pct = page.inner_text("#pct")
        opens = page.inner_text("#j-to")
        form_hidden = not page.is_visible("#unlock")
        print("  заголовок вкладки:", title)
        print("  счётчик:", clock)
        print("  пройдено:", pct, " откроется:", opens)
        print("  форма пароля спрятана:", form_hidden)
        if not form_hidden:
            problems.append("форма пароля видна до срока")

        # Видео обязано реально играть, а не просто присутствовать в разметке.
        played = page.evaluate("""async () => {
          const v = document.getElementById('greeting');
          v.muted = true;
          try { await v.play(); } catch (e) { return {ok: false, why: String(e)}; }
          await new Promise(r => setTimeout(r, 2000));
          return {ok: v.currentTime > 0.5, t: v.currentTime, dur: v.duration,
                  w: v.videoWidth, h: v.videoHeight};
        }""")
        print("  видео играет:", played)
        if not played.get("ok"):
            problems.append("видео не играет: %s" % played)

        page.screenshot(path="live-phone.png", full_page=True)
        print("  снимок: live-phone.png")

        if password:
            page.goto(base + "#open", wait_until="load", timeout=60000)
            page.wait_for_timeout(1500)
            page.fill("#vault-password", password)
            page.click("#unlock-btn")
            page.wait_for_selector(".gallery img", timeout=90000)
            page.wait_for_timeout(2000)
            shots = page.locator(".gallery .shots img").count()
            letters = page.locator(".gallery .letter").count()
            clips = page.locator(".gallery video").count()
            print("  хранилище открылось: фото %d, писем %d, роликов %d" % (shots, letters, clips))
            if shots == 0:
                problems.append("хранилище не отдало фотографии")

        print("  ошибок в консоли:", len(errors))
        for e in errors[:5]:
            print("    ", e)
        ctx.close()
        browser.close()

    print("\n=== ИТОГ")
    if problems:
        for p_ in problems:
            print("  ПРОБЛЕМА:", p_)
        sys.exit(1)
    print("  замечаний нет")


if __name__ == "__main__":
    main()
