#!/usr/bin/env node
/* Образец содержимого для проверки страницы без настоящих фото и видео.
   Делает sample/vault-src (письмо, 6 фото, 1 ролик) и заглушку docs/video.mp4 + poster.jpg.
   Настоящие файлы потом кладутся на их место. */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "sample", "vault-src");
fs.rmSync(src, { recursive: true, force: true });
fs.mkdirSync(src, { recursive: true });

function ff(args) {
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

fs.writeFileSync(
  path.join(src, "письмо.txt"),
  "Это образец письма. Настоящее письмо ты напишешь сам и положишь файлом .txt в папку хранилища.\n\n" +
    "Здесь может быть сколько угодно абзацев. Переносы строк сохраняются.\n\nОбнимаю, 2026."
);

const colors = [
  ["0x2B3A67", "0xD2A853"], ["0x6B2D3E", "0xF0DDA8"], ["0x1F4E5F", "0xE7DFCB"],
  ["0x3E2F5B", "0xD2A853"], ["0x5B4A1F", "0xF4EFE4"], ["0x24363B", "0xC7B47A"],
];
colors.forEach(([c0, c1], i) => {
  ff(["-f", "lavfi", "-i", `gradients=s=900x700:c0=${c0}:c1=${c1}:nb_colors=2:duration=1`, "-frames:v", "1", "-q:v", "4", path.join(src, `фото-${i + 1}.jpg`)]);
});

ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=3", "-f", "lavfi", "-i", "sine=f=330:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(src, "ролик.mp4")]);

// Заглушка видеопослания, пока настоящее не записано.
const docs = path.join(root, "docs");
ff(["-f", "lavfi", "-i", "gradients=s=1280x720:c0=0x0F1626:c1=0x26334F:nb_colors=2:speed=0.02:d=6", "-f", "lavfi", "-i", "sine=f=220:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", path.join(docs, "video.mp4")]);
ff(["-ss", "1", "-i", path.join(docs, "video.mp4"), "-frames:v", "1", "-q:v", "3", path.join(docs, "poster.jpg")]);

const made = fs.readdirSync(src);
console.log(`Образец: ${made.length} файлов в ${src}`);
console.log(`Заглушка видео: ${path.join(docs, "video.mp4")} (${(fs.statSync(path.join(docs, "video.mp4")).size / 1024).toFixed(0)} KiB)`);
