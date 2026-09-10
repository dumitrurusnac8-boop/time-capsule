/* Капсула времени: таймеры и открытие хранилища.
   Файл работает и в браузере (обычный <script>), и в Node (для тестов). */

(function (root) {
  "use strict";

  const MS_DAY = 86400000;

  // ---------- даты ----------

  // "2036-09-19" -> полночь этой даты в местном времени.
  function parseLocal(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  // Прибавить n лет; 29 февраля прижимается к 28-му, если в целевом году его нет.
  function addYears(date, n) {
    const r = new Date(date.getTime());
    const month = r.getMonth();
    r.setFullYear(r.getFullYear() + n);
    if (r.getMonth() !== month) r.setDate(0);
    return r;
  }

  // Прибавить n календарных дней, сохраняя время на часах (устойчиво к переводу часов).
  function addDays(date, n) {
    const r = new Date(date.getTime());
    r.setDate(r.getDate() + n);
    return r;
  }

  // Разница from -> to в годах, днях, часах, минутах, секундах.
  function breakdown(from, to) {
    if (to <= from) {
      return { years: 0, days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
    }
    let years = to.getFullYear() - from.getFullYear();
    while (years > 0 && addYears(from, years) > to) years--;
    const afterYears = addYears(from, years);

    let days = Math.floor((to - afterYears) / MS_DAY);
    while (days > 0 && addDays(afterYears, days) > to) days--;
    while (addDays(afterYears, days + 1) <= to) days++;
    const afterDays = addDays(afterYears, days);

    let rest = Math.floor((to - afterDays) / 1000);
    const hours = Math.floor(rest / 3600);
    rest -= hours * 3600;
    const minutes = Math.floor(rest / 60);
    const seconds = rest - minutes * 60;
    return { years, days, hours, minutes, seconds, done: false };
  }

  // Доля пути от sealed до opens в момент now, 0..1.
  function progressOf(sealed, opens, now) {
    const span = opens - sealed;
    if (span <= 0) return 1;
    const p = (now - sealed) / span;
    return Math.min(1, Math.max(0, p));
  }

  function plural(n, forms) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  const FORMS = {
    years: ["год", "года", "лет"],
    days: ["день", "дня", "дней"],
    hours: ["час", "часа", "часов"],
    minutes: ["минута", "минуты", "минут"],
    seconds: ["секунда", "секунды", "секунд"],
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatDateRu(date) {
    const s = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    return s.replace(/\s*г\.$/, "");
  }

  function formatPercent(p) {
    return (p * 100).toFixed(4).replace(".", ",") + " %";
  }

  function formatSince(b) {
    const parts = [];
    if (b.years > 0) parts.push(`${b.years} ${plural(b.years, FORMS.years)}`);
    parts.push(`${b.days} ${plural(b.days, FORMS.days)}`);
    parts.push(`${pad2(b.hours)}:${pad2(b.minutes)}:${pad2(b.seconds)}`);
    return parts.join(" ");
  }

  // ---------- шифрование ----------
  // Формат хранилища v1: PBKDF2-SHA256 -> ключ AES-GCM-256.
  // Каждый файл: 12 байт IV, затем шифртекст с тегом на конце (как отдаёт WebCrypto и Node).

  function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, saltBytes, iterations, subtle) {
    subtle = subtle || root.crypto.subtle;
    const raw = new TextEncoder().encode(String(password).normalize("NFC"));
    const base = await subtle.importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptBytes(key, bytes, subtle) {
    subtle = subtle || root.crypto.subtle;
    const iv = bytes.slice(0, 12);
    const body = bytes.slice(12);
    const plain = await subtle.decrypt({ name: "AES-GCM", iv }, key, body);
    return new Uint8Array(plain);
  }

  const api = {
    parseLocal, addYears, addDays, breakdown, progressOf, plural, FORMS,
    formatDateRu, formatPercent, formatSince, b64ToBytes, deriveKey, decryptBytes,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  // ---------- страница ----------

  const C = root.CAPSULE_CONFIG || {};
  const sealedAt = parseLocal(C.sealedAt || "2026-09-19");
  const opensAt = parseLocal(C.opensAt || "2036-09-19");

  const $ = (id) => document.getElementById(id);
  const nums = {};
  const lbls = {};
  for (const el of document.querySelectorAll("[data-num]")) nums[el.dataset.num] = el;
  for (const el of document.querySelectorAll("[data-lbl]")) lbls[el.dataset.lbl] = el;

  const ring = $("ring");
  const pct = $("pct");
  const since = $("since");
  const countdown = document.querySelector(".countdown");
  const cdTitle = $("cd-title");
  const vault = $("vault");
  const vaultText = $("vault-text");
  const unlock = $("unlock");
  const unlockMsg = $("unlock-msg");
  const unlockBtn = $("unlock-btn");
  const passwordInput = $("vault-password");
  const gallery = $("gallery");

  // Заголовок и даты.
  if (C.friendName) {
    $("for-whom").textContent = `для ${C.friendName}`;
    $("for-whom").hidden = false;
  }
  $("sealed-date").textContent = formatDateRu(sealedAt);
  $("open-date").textContent = formatDateRu(opensAt) + " года";
  $("j-from").textContent = formatDateRu(sealedAt);
  $("j-to").textContent = formatDateRu(opensAt);
  $("seal-year").textContent = String(opensAt.getFullYear());

  // Видео.
  const video = $("greeting");
  if (C.videoAspect) video.style.setProperty("--video-aspect", C.videoAspect);
  if (C.poster) video.poster = C.poster;
  const source = document.createElement("source");
  source.src = C.video || "video.mp4";
  source.type = "video/mp4";
  video.prepend(source);
  $("video-link").href = source.src;
  video.addEventListener("loadedmetadata", () => {
    if (video.videoWidth && video.videoHeight) {
      video.style.setProperty("--video-aspect", `${video.videoWidth} / ${video.videoHeight}`);
    }
  });

  // Режим просмотра: #open показывает открытое хранилище до срока, #sealed прячет его после.
  function isOpenNow(now) {
    if (location.hash === "#open") return true;
    if (location.hash === "#sealed") return false;
    return now >= opensAt;
  }

  let shownOpen = null;

  function tick() {
    const now = new Date();
    const left = breakdown(now, opensAt);
    for (const k of ["years", "days"]) {
      nums[k].textContent = String(left[k]);
      lbls[k].textContent = plural(left[k], FORMS[k]);
    }
    for (const k of ["hours", "minutes", "seconds"]) {
      nums[k].textContent = pad2(left[k]);
      lbls[k].textContent = plural(left[k], FORMS[k]);
    }

    const p = progressOf(sealedAt, opensAt, now);
    const v = +(p * 100).toFixed(2);
    ring.value = v;
    ring.style.setProperty("--value", String(v));
    pct.textContent = formatPercent(p);

    since.textContent = formatSince(breakdown(sealedAt, now));

    const open = isOpenNow(now);
    if (open !== shownOpen) {
      shownOpen = open;
      countdown.classList.toggle("is-done", left.done);
      cdTitle.textContent = left.done ? "Хранилище открыто" : "До открытия хранилища";
      unlock.hidden = !open;
      vaultText.textContent = open
        ? "Хранилище открыто. Пароль лежит в конверте, который ты получил вместе с этой страницей."
        : `Внутри письмо тебе в будущее, фотографии и видео. Замок откроется ${formatDateRu(opensAt)} года.`;
    }
  }

  tick();
  setInterval(tick, 1000);
  window.addEventListener("hashchange", tick);

  // ---------- открытие хранилища ----------

  async function fetchBytes(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`missing:${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  function setMsg(text, isError) {
    unlockMsg.textContent = text;
    unlockMsg.classList.toggle("is-error", Boolean(isError));
  }

  function kindOf(item) {
    if (item.kind) return item.kind;
    const t = item.type || "";
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("video/")) return "video";
    if (t.startsWith("text/")) return "letter";
    return "file";
  }

  async function openVault(password) {
    const dir = C.vaultDir || "vault";
    let meta;
    try {
      const res = await fetch(`${dir}/vault.json`, { cache: "no-store" });
      if (!res.ok) throw new Error("missing");
      meta = await res.json();
    } catch (e) {
      throw new Error("no-vault");
    }
    const key = await deriveKey(password, b64ToBytes(meta.kdf.salt), meta.kdf.iterations);
    const manifestBytes = await fetchBytes(`${dir}/${meta.manifest}`);
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(await decryptBytes(key, manifestBytes)));
    } catch (e) {
      throw new Error("bad-password");
    }
    return { dir, key, manifest };
  }

  async function renderVault({ dir, key, manifest }) {
    gallery.replaceChildren();
    gallery.hidden = false;
    const status = document.createElement("p");
    status.className = "gallery-status";
    gallery.append(status);

    const items = manifest.items || [];
    const shots = document.createElement("div");
    shots.className = "shots";
    const files = document.createElement("ul");
    files.className = "files";

    let n = 0;
    for (const item of items) {
      n++;
      status.textContent = `Открываю ${n} из ${items.length}`;
      const bytes = await decryptBytes(key, await fetchBytes(`${dir}/${item.id}`));
      const kind = kindOf(item);

      if (kind === "letter") {
        const art = document.createElement("article");
        art.className = "letter";
        const title = document.createElement("p");
        title.className = "letter-title";
        title.textContent = item.title || item.name.replace(/\.[^.]+$/, "");
        art.append(title, document.createTextNode(new TextDecoder().decode(bytes)));
        gallery.insertBefore(art, status);
        continue;
      }

      const url = URL.createObjectURL(new Blob([bytes], { type: item.type || "application/octet-stream" }));

      if (kind === "image") {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        const img = document.createElement("img");
        img.src = url;
        img.alt = item.name;
        img.loading = "lazy";
        a.append(img);
        shots.append(a);
        if (!shots.isConnected) gallery.insertBefore(shots, status);
        continue;
      }

      if (kind === "video") {
        const v = document.createElement("video");
        v.className = "clip";
        v.controls = true;
        v.playsInline = true;
        v.preload = "metadata";
        v.src = url;
        gallery.insertBefore(v, status);
        continue;
      }

      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      a.textContent = item.name;
      li.append(a);
      files.append(li);
      if (!files.isConnected) gallery.insertBefore(files, status);
    }
    status.textContent = items.length ? "" : "Хранилище пустое.";
  }

  unlock.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const password = passwordInput.value;
    if (!password) return;
    unlockBtn.disabled = true;
    setMsg("Подбираю ключ к замку.");
    try {
      const opened = await openVault(password);
      setMsg("");
      vault.classList.add("is-open");
      unlock.hidden = true;
      vaultText.textContent = "Открыто.";
      await renderVault(opened);
    } catch (e) {
      if (e.message === "bad-password") setMsg("Пароль не подошёл. Сверь с конвертом, буква в букву.", true);
      else if (e.message === "no-vault") setMsg("Хранилище ещё не заполнено.", true);
      else setMsg("Не удалось открыть: " + e.message, true);
    } finally {
      unlockBtn.disabled = false;
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
