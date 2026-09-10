# Выложить капсулу на GitHub Pages. Запускать из папки проекта:  .\deploy.ps1
# Первый запуск создаёт публичный репозиторий time-capsule и включает Pages из папки /docs.
# Повторные запуски просто отправляют изменения.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$repo = "time-capsule"
$login = (gh api user --jq ".login")
if (-not $login) { throw "gh не залогинен: выполни gh auth login" }

if (-not (Test-Path ".git")) {
  git init -b main | Out-Null
}
git add -A
git commit -m "Капсула времени" --quiet 2>$null | Out-Null

$exists = $true
try { gh repo view "$login/$repo" --json name | Out-Null } catch { $exists = $false }

if (-not $exists) {
  gh repo create $repo --public --source . --remote origin --push
  $body = '{"source":{"branch":"main","path":"/docs"}}'
  $body | gh api -X POST "repos/$login/$repo/pages" --input - | Out-Null
} else {
  git push origin main
}

$url = "https://$login.github.io/$repo/"
Write-Host ""
Write-Host "Адрес капсулы: $url"
Write-Host "Первая сборка Pages занимает 1-3 минуты. Проверь адрес в браузере, потом делай QR:"
Write-Host "    npm run qr -- $url"
