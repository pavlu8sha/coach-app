# Импорт из выгрузки таблиц одной командой (PowerShell). По умолчанию — проверка без записи; запись — ключ -Write.
#   .\scripts\import\final-import.ps1 -Dir "C:\...\migration-export 2026-10-31 19-05" -Mode Final            # проверка
#   .\scripts\import\final-import.ps1 -Dir "..." -Mode Final -Write                                          # запись
#   .\scripts\import\final-import.ps1 -Dir "..." -Mode Final -ShowOnly                                       # только показать команды
# Режимы: Final — полный импорт (в том числе посещаемость и матчи; для вечера 31.10, после него эти два раздела больше не импортируются);
#         Daily — без посещаемости и матчей (после перехода тренеров; администраторы ещё в старом приложении).
# Нужны SUPABASE_URL (без /rest/v1), CLUB_ID; ключ SUPABASE_SERVICE_KEY спросит скрипт. Ключ в историю и в чат не попадает.
# Остановка при первой ошибке. Скрипт ничего не удаляет сам; запись делают импортные скрипты слиянием (повторный запуск безопасен).
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [ValidateSet('Final', 'Daily')][string]$Mode = 'Daily',
  [switch]$Write,
  [switch]$ShowOnly
)
$ErrorActionPreference = 'Stop'
$Dir = (Resolve-Path -LiteralPath $Dir).Path
if (-not $env:SUPABASE_URL -or -not $env:CLUB_ID) { throw 'Задайте SUPABASE_URL и CLUB_ID (см. scripts/import/README.md).' }
if (-not $ShowOnly -and -not $env:SUPABASE_SERVICE_KEY) { $env:SUPABASE_SERVICE_KEY = Read-Host 'Ключ (service)' }

function Find-Csv([string]$name) {
  $f = @(Get-ChildItem -LiteralPath $Dir -Recurse -File -Filter $name)
  if ($f.Count -ne 1) { throw "В выгрузке нужен ровно один файл '$name', найдено: $($f.Count)." }
  return $f[0].FullName
}
function Find-Dir([string]$name) {
  $d = Join-Path $Dir $name
  if (-not (Test-Path -LiteralPath $d -PathType Container)) { throw "В выгрузке нет папки '$name'." }
  return $d
}
function Run([string]$label, [string[]]$nodeArgs) {
  if ($Write) { $nodeArgs += '--write' }
  Write-Host ''
  Write-Host "== $label"
  if ($ShowOnly) {
    $q = ($nodeArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    Write-Host "node $q"
    return
  }
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw "Остановка: шаг '$label' завершился с кодом $LASTEXITCODE" }
}

$reg   = Find-Csv 'РЕЕСТР ИГРОКОВ.csv'
$sched = Find-Csv 'РАСПИСАНИЕ.csv'
$log   = Find-Csv 'Тренировки.csv'
$S = 'scripts/import'

Run 'Игроки и группы' @("$S/run-players.mjs", $reg)
Run 'Даты рождения' @("$S/run-birth.mjs", '--registry', $reg, '--overrides', (Find-Csv 'ДАТЫ РОЖДЕНИЯ.csv'), '--pay-dir', (Find-Dir 'PAY_ID'))
Run 'Расписание и журнал тренировок' @("$S/run-schedule-log.mjs", '--registry', $reg, '--schedule', $sched, '--log', $log)
if ($Mode -eq 'Final') {
  Run 'Посещаемость' @("$S/run-attendance.mjs", '--registry', $reg, '--schedule', $sched, '--log', $log, '--att-dir', (Find-Dir 'ATT_ID'))
  Run 'Матчи: только новые, составы новых, взносы' @("$S/run-events.mjs", '--registry', $reg, '--events', (Find-Csv 'МАТЧИ.csv'), '--fees', (Find-Csv 'ВЗНОСЫ МАТЧЕЙ.csv'), '--games', (Find-Dir 'GAMES_ID'), '--log', (Find-Csv 'Игры.csv'), '--new-only')
}
$months = @(Get-ChildItem -LiteralPath (Find-Dir 'PAY_ID') -File -Filter '*.csv' | Sort-Object Name | ForEach-Object { $_.FullName })
Run 'Оплаты абонементов' (@("$S/run-payments.mjs", '--registry', $reg) + $months)
Run 'Индивидуальные и вратарские' @("$S/run-individual.mjs", '--registry', $reg, '--pay-dir', (Find-Dir 'PAY_ID'), '--sessions', (Find-Csv 'ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ.csv'), '--journal', (Find-Csv 'ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ.csv'), '--old-dir', (Find-Dir 'IND_ID'))
Run 'Экипировка' @("$S/run-equipment.mjs", (Find-Csv 'КАТАЛОГ ЭКИПИРОВКИ.csv'), (Find-Csv 'СЕЗОН 2026-2027.csv'))
Run 'Сборы и настройки' @("$S/run-camps-settings.mjs", $Dir)
Run 'Баллы за тренировки (без матчей)' @("$S/run-rating.mjs")

if (-not $ShowOnly) {
  Write-Host ''
  Write-Host '== Сверка с выгрузкой (verify)'
  & node "$S/verify.mjs" $Dir
  if ($LASTEXITCODE -ne 0) { Write-Host "Сверка нашла расхождения (код $LASTEXITCODE): пришлите вывод разработчику." }
  if ($Mode -eq 'Final' -and $Write) { Write-Host 'Готово. Дальше: «Ещё → Пересчёт баллов за матчи» в приложении (под администратором).' }
}
