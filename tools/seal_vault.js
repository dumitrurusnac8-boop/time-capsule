#!/usr/bin/env node
/* Запечатать папку в зашифрованное хранилище.

   node tools/seal_vault.js <папка> [--out docs/vault] [--password "..."]

   Без --password пароль генерируется и печатается ОДИН раз. Запиши его на бумагу.
   Формат: PBKDF2-SHA256 (600 000 итераций) -> AES-256-GCM, каждый файл отдельно,
   12 байт IV в начале, тег в конце. Ровно то, что читает docs/capsule.js.
   После записи хранилище расшифровывается обратно и сверяется байт в байт. */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ITERATIONS = 600000;

const TYPES = {
  ".txt": ["text/plain", "letter"],
  ".md": ["text/plain", "letter"],
  ".jpg": ["image/jpeg", "image"],
  ".jpeg": ["image/jpeg", "image"],
  ".png": ["image/png", "image"],
  ".gif": ["image/gif", "image"],
  ".webp": ["image/webp", "image"],
  ".svg": ["image/svg+xml", "image"],
  ".mp4": ["video/mp4", "video"],
  ".webm": ["video/webm", "video"],
  ".m4v": ["video/mp4", "video"],
};

const KIND_ORDER = { letter: 0, image: 1, video: 2, file: 3 };

function parseArgs(argv) {
  const args = { out: path.join("docs", "vault"), password: null, src: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--password") args.password = argv[++i];
    else if (!args.src) args.src = a;
    else throw new Error(`лишний аргумент: ${a}`);
  }
  if (!args.src) throw new Error("укажи папку с содержимым хранилища");
  return args;
}

// Пароль без букв, которые путаются при переписывании от руки (0/O, 1/l/I).
function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let s = "";
    for (let i = 0; i < 5; i++) s += alphabet[crypto.randomInt(alphabet.length)];
    groups.push(s);
  }
  return groups.join("-");
}

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(Buffer.from(password.normalize("NFC"), "utf8"), salt, ITERATIONS, 32, "sha256");
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

function decrypt(key, blob) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const body = blob.subarray(12, blob.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

function listFiles(src) {
  const names = fs.readdirSync(src).filter((n) => !n.startsWith(".") && fs.statSync(path.join(src, n)).isFile());
  const items = names.map((name) => {
    const ext = path.extname(name).toLowerCase();
    const [type, kind] = TYPES[ext] || ["application/octet-stream", "file"];
    return { name, type, kind, size: fs.statSync(path.join(src, name)).size };
  });
  items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, "ru"));
  return items;
}

function seal({ src, out, password }) {
  const items = listFiles(src);
  if (items.length === 0) throw new Error(`в папке ${src} нет файлов`);

  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const manifestItems = [];
  const metaFiles = [];
  items.forEach((item, i) => {
    const id = `f${String(i + 1).padStart(3, "0")}.bin`;
    const plain = fs.readFileSync(path.join(src, item.name));
    const blob = encrypt(key, plain);
    fs.writeFileSync(path.join(out, id), blob);
    manifestItems.push({ id, name: item.name, type: item.type, kind: item.kind, size: item.size });
    metaFiles.push({ id, size: blob.length });
  });

  const manifestBlob = encrypt(key, Buffer.from(JSON.stringify({ items: manifestItems }), "utf8"));
  fs.writeFileSync(path.join(out, "manifest.bin"), manifestBlob);

  const meta = {
    version: 1,
    cipher: "AES-GCM",
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: salt.toString("base64") },
    manifest: "manifest.bin",
    files: metaFiles,
  };
  fs.writeFileSync(path.join(out, "vault.json"), JSON.stringify(meta, null, 2) + "\n");
  return { items, meta };
}

// Обратная проверка: расшифровать всё тем же паролем и сравнить с исходником.
function verify({ src, out, password }) {
  const meta = JSON.parse(fs.readFileSync(path.join(out, "vault.json"), "utf8"));
  const key = deriveKey(password, Buffer.from(meta.kdf.salt, "base64"));
  const manifest = JSON.parse(decrypt(key, fs.readFileSync(path.join(out, meta.manifest))).toString("utf8"));
  let ok = 0;
  for (const item of manifest.items) {
    const plain = decrypt(key, fs.readFileSync(path.join(out, item.id)));
    const original = fs.readFileSync(path.join(src, item.name));
    if (!plain.equals(original)) throw new Error(`не сошёлся файл ${item.name}`);
    ok++;
  }
  return { checked: ok, total: manifest.items.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const generated = !args.password;
  const password = args.password || generatePassword();

  const { items } = seal({ src: args.src, out: args.out, password });
  const v = verify({ src: args.src, out: args.out, password });

  const mib = (n) => (n / 1048576).toFixed(1);
  console.log(`Запечатано файлов: ${items.length}, сверено обратно: ${v.checked} из ${v.total}`);
  for (const it of items) {
    const warn = it.size > 100 * 1048576 ? "  <-- больше 100 MiB, GitHub такой файл не примет" : it.size > 50 * 1048576 ? "  <-- больше 50 MiB, GitHub предупредит" : "";
    console.log(`  ${it.kind.padEnd(6)} ${mib(it.size).padStart(7)} MiB  ${it.name}${warn}`);
  }
  console.log(`Папка хранилища: ${path.resolve(args.out)}`);
  if (generated) {
    console.log("");
    console.log("ПАРОЛЬ (печатается один раз, нигде не сохранён):");
    console.log("");
    console.log(`    ${password}`);
    console.log("");
    console.log("Запиши его на бумагу и положи в конверт. Потеряешь пароль, потеряешь хранилище.");
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error("Ошибка:", e.message);
    process.exit(1);
  }
}

module.exports = { seal, verify, deriveKey, encrypt, decrypt, generatePassword, ITERATIONS };
