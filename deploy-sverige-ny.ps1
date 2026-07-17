[CmdletBinding()]
param(
    [string]$ProjectRef = "vsxvuvzljvtxzoashsfw",
    [string[]]$Functions,
    [switch]$NoVerifyJwt
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Fast mappestruktur:
# C:\inetpub\wwwroot\rettilomma\supabase\deploy-sverige-ny.ps1
# C:\inetpub\wwwroot\rettilomma\supabase\config.toml
# C:\inetpub\wwwroot\rettilomma\supabase\functions\<funksjonsnavn>\index.ts
# C:\inetpub\wwwroot\rettilomma\hovslager\js\hovslager\config.js

$SupabaseDir = $PSScriptRoot
$FunctionsDir = Join-Path $SupabaseDir "functions"
$RettilommaDir = Split-Path $SupabaseDir -Parent
$AppDir = Join-Path $RettilommaDir "hovslager"
$ConfigJs = Join-Path $AppDir "js\hovslager\config.js"
$ConfigToml = Join-Path $SupabaseDir "config.toml"

function Find-SupabaseCli {
    $cmd = Get-Command supabase -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $knownPaths = @(
        "C:\Program Files\supabase\supabase.exe",
        "C:\Tools\Supabase\supabase.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\supabase\supabase.exe")
    )

    foreach ($path in $knownPaths) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
            return $path
        }
    }

    throw "Supabase CLI ble ikke funnet. Kontroller at supabase.exe ligger i PATH eller i C:\Program Files\supabase."
}

function Invoke-Supabase {
    param([Parameter(Mandatory)][string[]]$Arguments)

    & $script:SupabaseCli @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Supabase CLI feilet med exit-kode $LASTEXITCODE: supabase $($Arguments -join ' ')"
    }
}

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
    $ProjectRef = Read-Host "Skriv project-ref for Supabase-prosjektet i Sverige"
}
if ($ProjectRef -notmatch '^[a-z0-9]{20}$') {
    throw "Ugyldig project-ref: '$ProjectRef'. Forventet 20 små bokstaver/tall."
}

$script:SupabaseCli = Find-SupabaseCli

if (-not (Test-Path -LiteralPath $FunctionsDir -PathType Container)) {
    throw "Fant ikke Edge Functions-mappen: $FunctionsDir"
}

Write-Host "" 
Write-Host "Supabase Edge Functions-deploy til Sverige" -ForegroundColor Cyan
Write-Host "CLI:        $script:SupabaseCli"
Write-Host "Prosjekt:   $ProjectRef"
Write-Host "Supabase:   $SupabaseDir"
Write-Host "Functions:  $FunctionsDir"
Write-Host "App:        $AppDir"
Write-Host "config.js:  $ConfigJs"

if (-not (Test-Path -LiteralPath $ConfigJs -PathType Leaf)) {
    Write-Warning "Fant ikke config.js på forventet sted. Edge Functions kan fortsatt deployes, men kontroller appbanen."
}

if (-not (Test-Path -LiteralPath $ConfigToml -PathType Leaf)) {
    Write-Warning "Fant ikke config.toml i $SupabaseDir. Deploy kan fortsatt fungere, men funksjonsinnstillinger som verify_jwt kan mangle."
}

$availableFunctions = Get-ChildItem -LiteralPath $FunctionsDir -Directory |
    Where-Object {
        $_.Name -notmatch '^_' -and
        $_.Name -ne '.shared' -and
        $_.Name -ne '_shared' -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'index.ts') -PathType Leaf)
    } |
    Select-Object -ExpandProperty Name |
    Sort-Object

if (-not $availableFunctions -or $availableFunctions.Count -eq 0) {
    throw "Fant ingen Edge Functions med index.ts i $FunctionsDir"
}

if ($Functions -and $Functions.Count -gt 0) {
    $missing = @($Functions | Where-Object { $_ -notin $availableFunctions })
    if ($missing.Count -gt 0) {
        throw "Disse funksjonene finnes ikke lokalt: $($missing -join ', ')"
    }
    $functionsToDeploy = @($Functions)
}
else {
    $functionsToDeploy = @($availableFunctions)
}

Write-Host "" 
Write-Host "Funksjoner som deployes:" -ForegroundColor Yellow
$functionsToDeploy | ForEach-Object { Write-Host "  - $_" }

Push-Location $SupabaseDir
try {
    Write-Host "" 
    Write-Host "Kontrollerer Supabase CLI ..." -ForegroundColor Cyan
    Invoke-Supabase -Arguments @('--version')

    Write-Host "" 
    Write-Host "Hvis CLI ber om innlogging, kjør 'supabase login' i dette vinduet og start skriptet på nytt." -ForegroundColor DarkGray

    foreach ($functionName in $functionsToDeploy) {
        Write-Host "" 
        Write-Host "Deploy: $functionName" -ForegroundColor Yellow

        $args = @('functions', 'deploy', $functionName, '--project-ref', $ProjectRef)
        if ($NoVerifyJwt) {
            $args += '--no-verify-jwt'
        }

        Invoke-Supabase -Arguments $args
        Write-Host "OK: $functionName" -ForegroundColor Green
    }
}
finally {
    Pop-Location
}

Write-Host "" 
Write-Host "Ferdig. Alle valgte Edge Functions er deployet til Sverige." -ForegroundColor Green
Write-Host "Prosjekt: https://supabase.com/dashboard/project/$ProjectRef/functions" -ForegroundColor Cyan
Write-Host "Merk: Skriptet endrer ikke config.js eller hemmeligheter." -ForegroundColor DarkGray
