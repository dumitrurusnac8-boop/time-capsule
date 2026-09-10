#!/usr/bin/env node
/* Сжать видеопослание для сайта и вырезать кадр-обложку.

   node tools/compress_video.js <исходник.mov|mp4> [--out docs/video.mp4] [--crf 24] [--max 1280] [--poster-at 1]

   Длинная сторона кадра ужимается до --max (1280 по умолчанию), H.264 + AAC,
   faststart для запуска до полной загрузки. Обложка пишется рядом как poster.jpg. */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");

function run(args) {
  const r = spawnSync(ffmpeg, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`ffmpeg завершился с кодом ${r.status}\n${(r.stderr || "").split("\n").slice(-15).join("\n")}`);
  }
  return r.stderr || "";
}

function main() {
  const argv = process.argv.slice(2);
  const o = { out: path.join("docs", "video.mp4"), crf: "24", max: "1280", posterAt: "1", src: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") o.out = argv[++i];
    else if (a === "--crf") o.crf = argv[++i];
    else if (a === "--max") o.max = argv[++i];
    else if (a === "--poster-at") o.posterAt = argv[++i];
    else if (!o.src) o.src = a;
  }
  if (!o.src || !fs.existsSync(o.src)) throw new Error("укажи существующий файл видео");
  fs.mkdirSync(path.dirname(o.out), { recursive: true });

  // Длинная сторона <= max, размеры чётные (требование H.264).
  const scale = `scale='if(gt(iw,ih),min(${o.max},iw),-2)':'if(gt(iw,ih),-2,min(${o.max},ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2`;
  run([
    "-y", "-i", o.src,
    "-vf", scale,
    "-c:v", "libx264", "-crf", o.crf, "-preset", "slow", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    o.out,
  ]);

  const poster = path.join(path.dirname(o.out), "poster.jpg");
  const log = run(["-y", "-ss", o.posterAt, "-i", o.out, "-frames:v", "1", "-q:v", "3", poster]);

  const m = log.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const size = fs.statSync(o.out).size;
  const mib = size / 1048576;
  console.log(`Видео: ${path.resolve(o.out)}  ${mib.toFixed(1)} MiB`);
  console.log(`Обложка: ${path.resolve(poster)}`);
  if (m) {
    const w = +m[1], h = +m[2];
    console.log(`Кадр ${w}x${h}. В docs/config.js поставь videoAspect: "${w} / ${h}"`);
  }
  if (mib > 100) console.log("ВНИМАНИЕ: больше 100 MiB, GitHub такой файл не примет. Подними --crf до 28 или --max до 960.");
  else if (mib > 50) console.log("Больше 50 MiB: GitHub предупредит, но примет. Можно поднять --crf до 26.");
}

try {
  main();
} catch (e) {
  console.error("Ошибка:", e.message);
  process.exit(1);
}
