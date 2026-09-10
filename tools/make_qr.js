#!/usr/bin/env node
/* Сделать QR-код на адрес капсулы.

   node tools/make_qr.js https://имя.github.io/time-capsule/ [--out out/qr]

   Пишет qr.svg (для печати, масштабируется без потерь) и qr.png (1024 px).
   Уровень коррекции H: код читается даже если четверть картинки испорчена. */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");

async function main() {
  const argv = process.argv.slice(2);
  let url = null;
  let out = path.join("out", "qr");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i];
    else if (!url) url = argv[i];
  }
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error("укажи полный адрес страницы, начиная с https://");
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const opts = { errorCorrectionLevel: "H", margin: 4, color: { dark: "#0F1626", light: "#FFFFFF" } };
  const svg = await QRCode.toString(url, { ...opts, type: "svg" });
  fs.writeFileSync(out + ".svg", svg);
  await QRCode.toFile(out + ".png", url, { ...opts, width: 1024 });

  console.log(`Адрес в коде: ${url}`);
  console.log(`Файлы: ${path.resolve(out + ".svg")} и ${path.resolve(out + ".png")}`);
  console.log("Перед печатью отсканируй PNG телефоном и убедись, что открывается страница.");
}

main().catch((e) => {
  console.error("Ошибка:", e.message);
  process.exit(1);
});
