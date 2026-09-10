#!/usr/bin/env node
/* Проверки капсулы: арифметика таймеров и совместимость шифрования
   между tools/seal_vault.js (Node crypto) и docs/capsule.js (WebCrypto). */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const cap = require("../docs/capsule.js");
const sealer = require("./seal_vault.js");

let passed = 0;
let failed = 0;
const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

function pick(b) {
  return [b.years, b.days, b.hours, b.minutes, b.seconds, b.done];
}

// ---------- таймеры ----------

check("ровно десять лет", () => {
  assert.deepEqual(pick(cap.breakdown(new Date(2026, 8, 19), new Date(2036, 8, 19))), [10, 0, 0, 0, 0, false]);
});

check("10 лет 8 дней 12 часов", () => {
  assert.deepEqual(pick(cap.breakdown(new Date(2026, 8, 10, 12), new Date(2036, 8, 19))), [10, 8, 12, 0, 0, false]);
});

check("последние 30 секунд", () => {
  assert.deepEqual(pick(cap.breakdown(new Date(2036, 8, 18, 23, 59, 30), new Date(2036, 8, 19))), [0, 0, 0, 0, 30, false]);
});

check("срок прошёл: нули и done", () => {
  assert.deepEqual(pick(cap.breakdown(new Date(2036, 8, 19, 0, 0, 1), new Date(2036, 8, 19))), [0, 0, 0, 0, 0, true]);
});

check("день до годовщины не считается годом", () => {
  assert.deepEqual(pick(cap.breakdown(new Date(2026, 8, 19), new Date(2027, 8, 18))), [0, 364, 0, 0, 0, false]);
});

check("29 февраля прижимается к 28-му", () => {
  assert.deepEqual(pick(cap.breakdown(new Date(2028, 1, 29), new Date(2029, 2, 1))), [1, 1, 0, 0, 0, false]);
});

check("переход через перевод часов не крадёт час у дней", () => {
  // Март -> сентябрь: в зонах с летним временем разница в мс не кратна суткам.
  const b = cap.breakdown(new Date(2027, 2, 1, 10, 0, 0), new Date(2027, 8, 1, 10, 0, 0));
  assert.deepEqual([b.years, b.days, b.minutes, b.seconds], [0, 184, 0, 0]);
  assert.ok(b.hours === 0 || b.hours === 24, `часов ${b.hours}`);
});

check("доля пути: 0 в начале, 1 в конце, 0.5 посередине, зажата в границах", () => {
  const s = new Date(2026, 8, 19), o = new Date(2036, 8, 19);
  assert.equal(cap.progressOf(s, o, s), 0);
  assert.equal(cap.progressOf(s, o, o), 1);
  assert.equal(cap.progressOf(s, o, new Date((s.getTime() + o.getTime()) / 2)), 0.5);
  assert.equal(cap.progressOf(s, o, new Date(2020, 0, 1)), 0);
  assert.equal(cap.progressOf(s, o, new Date(2040, 0, 1)), 1);
});

check("русские формы числа", () => {
  const f = cap.FORMS.years;
  assert.equal(cap.plural(1, f), "год");
  assert.equal(cap.plural(2, f), "года");
  assert.equal(cap.plural(5, f), "лет");
  assert.equal(cap.plural(11, f), "лет");
  assert.equal(cap.plural(21, f), "год");
  assert.equal(cap.plural(0, cap.FORMS.days), "дней");
});

check("формат «прошло»", () => {
  assert.equal(cap.formatSince({ years: 0, days: 3, hours: 4, minutes: 5, seconds: 6 }), "3 дня 04:05:06");
  assert.equal(cap.formatSince({ years: 2, days: 1, hours: 0, minutes: 0, seconds: 0 }), "2 года 1 день 00:00:00");
});

check("формат процента: запятая и четыре знака", () => {
  assert.equal(cap.formatPercent(0.000271), "0,0271 %");
  assert.equal(cap.formatPercent(1), "100,0000 %");
});

// ---------- шифрование: Node запечатал, WebCrypto открыл ----------

async function cryptoRoundTrip() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-"));
  const src = path.join(tmp, "src");
  const out = path.join(tmp, "vault");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "письмо.txt"), "Привет из 2026 года.\nЭто проверка.");
  const bin = Buffer.alloc(70000);
  for (let i = 0; i < bin.length; i++) bin[i] = (i * 7) & 255;
  fs.writeFileSync(path.join(src, "b.jpg"), bin);
  fs.writeFileSync(path.join(src, "a.mp4"), Buffer.from("not really a video"));

  const password = "проверка-pass-2036";
  sealer.seal({ src, out, password });

  const meta = JSON.parse(fs.readFileSync(path.join(out, "vault.json"), "utf8"));
  const subtle = globalThis.crypto.subtle;
  const key = await cap.deriveKey(password, cap.b64ToBytes(meta.kdf.salt), meta.kdf.iterations, subtle);
  const manifestBytes = new Uint8Array(fs.readFileSync(path.join(out, meta.manifest)));
  const manifest = JSON.parse(new TextDecoder().decode(await cap.decryptBytes(key, manifestBytes, subtle)));

  assert.deepEqual(manifest.items.map((i) => i.name), ["письмо.txt", "b.jpg", "a.mp4"], "порядок: письмо, фото, видео");
  assert.deepEqual(manifest.items.map((i) => i.kind), ["letter", "image", "video"]);

  let opened = 0;
  for (const item of manifest.items) {
    const plain = await cap.decryptBytes(key, new Uint8Array(fs.readFileSync(path.join(out, item.id))), subtle);
    assert.ok(Buffer.from(plain).equals(fs.readFileSync(path.join(src, item.name))), `байты ${item.name}`);
    opened++;
  }
  assert.equal(opened, 3);

  // Неверный пароль обязан упасть, а не вернуть мусор.
  const wrongKey = await cap.deriveKey(password + "x", cap.b64ToBytes(meta.kdf.salt), meta.kdf.iterations, subtle);
  await assert.rejects(cap.decryptBytes(wrongKey, manifestBytes, subtle), "чужой пароль прошёл");

  // Порча одного байта тоже обязана упасть (тег GCM).
  const damaged = new Uint8Array(manifestBytes);
  damaged[20] ^= 1;
  await assert.rejects(cap.decryptBytes(key, damaged, subtle), "порченый файл прошёл");

  fs.rmSync(tmp, { recursive: true, force: true });
  return opened;
}

check("хранилище: Node запечатал, WebCrypto открыл 3 из 3, чужой пароль и порча отвергнуты", cryptoRoundTrip);

check("сгенерированный пароль: 4 группы по 5, без путающихся букв", () => {
  for (let i = 0; i < 50; i++) {
    const p = sealer.generatePassword();
    assert.match(p, /^[a-hj-km-np-z2-9]{5}(-[a-hj-km-np-z2-9]{5}){3}$/);
  }
});

(async () => {
  for (const c of checks) {
    try {
      await c.fn();
      passed++;
      console.log(`ok   ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${c.name}\n     ${e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${checks.length} total`);
  process.exit(failed ? 1 : 0);
})();
