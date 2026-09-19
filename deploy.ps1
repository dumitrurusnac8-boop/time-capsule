# Выложить капсулу на GitHub Pages. Запускать из папки проекта:  .\deploy.ps1
# Первый запуск создаёт публичный репозиторий time-capsule и включает Pages из папки /docs.
# Повторные запуски просто отправляют изменения.
#
# ВАЖНО: файл обязан лежать в UTF-8 С BOM. Без BOM PowerShell 5.1 читает его
# в системной кодировке, кириллица ломается, и скрипт не разбирается парсером.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$repo = "time-capsule"
$login = (gh api user --jq ".login")
if (-not $login) { throw "gh не залогинен: выполни gh auth login" }

if (-not (Test-Path ".git")) { git init -b main | Out-Null }

git add -A
git commit -m "Капсула времени" --quiet 2>$null | Out-Null

$exists = $true
try { gh repo view "$login/$repo" --json name | Out-Null } catch { $exists = $false }

if (-not $exists) {
  gh repo create $repo --public --source . --remote origin --push
} else {
  if (-not (git remote | Select-String -Quiet "^origin$")) {
    git remote add origin "https://github.com/$login/$repo.git"
  }
  git push -u origin main
}

# Включить Pages из папки /docs. Если уже включено, GitHub отвечает 409, это не ошибка.
$tmp = Join-Path $env:TEMP "pages-source.json"
'{"source":{"branch":"main","path":"/docs"}}' | Out-File $tmp -Encoding ascii -NoNewline
$pagesOk = $true
try { gh api -X POST "repos/$login/$repo/pages" --input $tmp 2>&1 | Out-Null } catch { $pagesOk = $false }
Remove-Item $tmp -ErrorAction SilentlyContinue

$url = "https://$login.github.io/$repo/"

# Дождаться сборки: опрашиваем адрес, пока не ответит 200.
Write-Host "Жду сборку GitHub Pages (до 5 минут)..."
$live = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $live = $true; break }
  } catch { }
  Start-Sleep -Seconds 5
}

Write-Host ""
if ($live) {
  Write-Host "ГОТОВО. Капсула открыта: $url"
} else {
  Write-Host "Адрес: $url"
  Write-Host "Сборка ещё идёт. Состояние: gh api repos/$login/$repo/pages --jq .status"
  if (-not $pagesOk) { Write-Host "Pages включить не удалось. Проверь Settings, раздел Pages." }
}
Write-Host "QR-код делается после того, как адрес открылся:  npm run qr -- $url"
