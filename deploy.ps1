# Выложить капсулу на GitHub Pages. Запускать из папки проекта:  .\deploy.ps1
# Первый запуск создаёт публичный репозиторий time-capsule и включает Pages из папки /docs.
# Повторные запуски просто отправляют изменения.
#
# ВАЖНО, два правила этого файла:
#  * он обязан лежать в UTF-8 С BOM, иначе PowerShell 5.1 не разберёт кириллицу;
#  * успех внешних программ проверяется ТОЛЬКО по $LASTEXITCODE. try/catch их
#    неудачу не ловит, а перенаправление 2>$null наоборот делает из обычного
#    сообщения stderr терминирующую ошибку.

Set-Location $PSScriptRoot

$repo = "time-capsule"
$login = (gh api user --jq ".login")
if ($LASTEXITCODE -ne 0 -or -not $login) { throw "gh не залогинен: выполни gh auth login" }

if (-not (Test-Path ".git")) { git init -b main | Out-Null }

git add -A
git commit -m "Капсула времени" --quiet | Out-Null

Write-Host "Проверяю, есть ли репозиторий $login/$repo. Строка GraphQL ниже, если она есть, означает просто 'ещё нет'."
gh repo view "$login/$repo" --json name | Out-Null
$exists = ($LASTEXITCODE -eq 0)

if (-not $exists) {
  Write-Host ""
  Write-Host "Создаю публичный репозиторий $login/$repo."
  if (git remote | Select-String -Quiet "^origin$") { git remote remove origin }
  gh repo create $repo --public --source . --remote origin --push
  if ($LASTEXITCODE -ne 0) { throw "не удалось создать репозиторий" }
} else {
  Write-Host "Репозиторий уже есть, отправляю изменения."
  if (-not (git remote | Select-String -Quiet "^origin$")) {
    git remote add origin "https://github.com/$login/$repo.git"
  }
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { throw "не удалось отправить изменения" }
}

# Включить Pages из папки /docs. Если уже включено, GitHub отвечает 409, это не ошибка.
$tmp = Join-Path $env:TEMP "pages-source.json"
'{"source":{"branch":"main","path":"/docs"}}' | Out-File $tmp -Encoding ascii -NoNewline
gh api -X POST "repos/$login/$repo/pages" --input $tmp | Out-Null
Remove-Item $tmp -ErrorAction SilentlyContinue

$pagesStatus = (gh api "repos/$login/$repo/pages" --jq ".status")
if ($LASTEXITCODE -ne 0) {
  Write-Host "Pages включить не удалось. Открой Settings, раздел Pages, и поставь ветку main, папку /docs."
} else {
  Write-Host "Pages включён, состояние: $pagesStatus"
}

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
}
Write-Host "QR-код делается после того, как адрес открылся:  npm run qr -- $url"
