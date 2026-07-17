$ErrorActionPreference = "Stop"

$ProjectRef = Read-Host "Skriv project-ref for Supabase-prosjektet i Sverige"
if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
    throw "Project-ref kan ikke være tom."
}

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    throw "Supabase CLI ble ikke funnet i PATH. Installer eller start Supabase CLI før du fortsetter."
}

$Root = $PSScriptRoot
$SupabaseDir = Join-Path $Root "supabase"

Write-Host "Logger inn i Supabase CLI ved behov ..." -ForegroundColor Cyan
Write-Host "Prosjekt i Sverige: $ProjectRef" -ForegroundColor Cyan

Push-Location $SupabaseDir
try {
    $functions = @(
        "backup-hovslager-firma",
        "daglig-appfaktura",
        "hov-backup",
        "oppdater-hov-firma",
        "opprett-hov-kunde"
    )

    foreach ($functionName in $functions) {
        Write-Host "" 
        Write-Host "Deploy: $functionName" -ForegroundColor Yellow
        & supabase functions deploy $functionName --project-ref $ProjectRef
        if ($LASTEXITCODE -ne 0) {
            throw "Deploy feilet for $functionName med exit-kode $LASTEXITCODE."
        }
    }
}
finally {
    Pop-Location
}

Write-Host "" 
Write-Host "Alle Edge Functions er deployet til Sverige-prosjektet." -ForegroundColor Green
Write-Host "Kontroller Functions og Logs i Supabase Dashboard." -ForegroundColor Green
