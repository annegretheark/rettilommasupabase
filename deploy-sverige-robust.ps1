[CmdletBinding()]
param(
    [string]$ProjectRef = "vsxvuvzljvtxzoashsfw",
    [string[]]$Functions,
    [switch]$SkipLogin,
    [switch]$SkipLink,
    [switch]$NoVerifyJwt
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Find-SupabaseCli {
    $command = Get-Command "supabase" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        "C:\Program Files\supabase\supabase.exe",
        "C:\Tools\Supabase\supabase.exe",
        "$env:LOCALAPPDATA\Supabase\supabase.exe",
        "$env:USERPROFILE\scoop\shims\supabase.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }

    throw @"
Supabase CLI ble ikke funnet.

Kontroller at supabase.exe finnes, for eksempel:
C:\Program Files\supabase\supabase.exe

Legg mappen midlertidig i PATH med:
`$env:Path += ";C:\Program Files\supabase"
"@
}

function Invoke-Supabase {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    Write-Host ""
    Write-Host ("--- {0} ---" -f $Description) -ForegroundColor Cyan
    Write-Host ("supabase {0}" -f ($Arguments -join " ")) -ForegroundColor DarkGray

    & $script:SupabaseCli @Arguments
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        throw ("Supabase CLI feilet med exit-kode {0} under: {1}" -f $exitCode, $Description)
    }
}

$SupabaseDir = $PSScriptRoot
$FunctionsDir = Join-Path $SupabaseDir "functions"
$ConfigPath = Join-Path $SupabaseDir "config.toml"
$AppConfigPath = Join-Path (Split-Path $SupabaseDir -Parent) "hovslager\js\hovslager\config.js"

if (-not (Test-Path -LiteralPath $FunctionsDir -PathType Container)) {
    throw ("Fant ikke Edge Functions-mappen: {0}" -f $FunctionsDir)
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    Write-Warning ("Fant ikke config.toml: {0}. Deploy kan fortsatt fungere, men funksjonsinnstillinger som verify_jwt blir ikke lest." -f $ConfigPath)
}

if (-not (Test-Path -LiteralPath $AppConfigPath -PathType Leaf)) {
    Write-Warning ("Fant ikke appens config.js: {0}. Skriptet endrer ikke config.js." -f $AppConfigPath)
}

$script:SupabaseCli = Find-SupabaseCli

Write-Host "Supabase Edge Functions deploy - Sverige" -ForegroundColor Green
Write-Host ("CLI:          {0}" -f $script:SupabaseCli)
Write-Host ("Supabase-dir: {0}" -f $SupabaseDir)
Write-Host ("Functions:    {0}" -f $FunctionsDir)
Write-Host ("Project-ref:  {0}" -f $ProjectRef)

& $script:SupabaseCli --version
if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI kunne ikke startes."
}

Push-Location $SupabaseDir
try {
    if (-not $SkipLogin) {
        Write-Host ""
        Write-Host "Kontrollerer innlogging..." -ForegroundColor Cyan

        & $script:SupabaseCli projects list *> $null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Du er ikke innlogget. Starter Supabase-innlogging..." -ForegroundColor Yellow
            Invoke-Supabase -Arguments @("login") -Description "Logger inn i Supabase"
        }
        else {
            Write-Host "Supabase CLI er innlogget." -ForegroundColor Green
        }
    }

    if (-not $SkipLink) {
        Invoke-Supabase `
            -Arguments @("link", "--project-ref", $ProjectRef) `
            -Description ("Linker lokalt prosjekt til {0}" -f $ProjectRef)
    }

    if ($Functions -and $Functions.Count -gt 0) {
        $functionNames = @($Functions)
    }
    else {
        $functionNames = @(
            Get-ChildItem -LiteralPath $FunctionsDir -Directory |
            Where-Object {
                (Test-Path -LiteralPath (Join-Path $_.FullName "index.ts") -PathType Leaf) -or
                (Test-Path -LiteralPath (Join-Path $_.FullName "index.js") -PathType Leaf)
            } |
            Select-Object -ExpandProperty Name |
            Sort-Object
        )
    }

    if ($functionNames.Count -eq 0) {
        throw ("Fant ingen funksjoner med index.ts eller index.js under {0}" -f $FunctionsDir)
    }

    Write-Host ""
    Write-Host ("Fant {0} funksjon(er):" -f $functionNames.Count) -ForegroundColor Green
    foreach ($name in $functionNames) {
        Write-Host ("  - {0}" -f $name)
    }

    $failed = New-Object System.Collections.Generic.List[string]
    $deployed = New-Object System.Collections.Generic.List[string]

    foreach ($name in $functionNames) {
        $functionPath = Join-Path $FunctionsDir $name
        if (-not (Test-Path -LiteralPath $functionPath -PathType Container)) {
            Write-Warning ("Hopper over ukjent funksjonsmappe: {0}" -f $name)
            $failed.Add($name)
            continue
        }

        $arguments = @(
            "functions",
            "deploy",
            $name,
            "--project-ref",
            $ProjectRef
        )

        if ($NoVerifyJwt) {
            $arguments += "--no-verify-jwt"
        }

        try {
            Invoke-Supabase `
                -Arguments $arguments `
                -Description ("Deployer funksjon: {0}" -f $name)

            $deployed.Add($name)
        }
        catch {
            Write-Warning $_.Exception.Message
            $failed.Add($name)
        }
    }

    Write-Host ""
    Write-Host "Deploy-oppsummering" -ForegroundColor Cyan
    Write-Host ("Deployet: {0}" -f $deployed.Count) -ForegroundColor Green
    foreach ($name in $deployed) {
        Write-Host ("  OK  {0}" -f $name) -ForegroundColor Green
    }

    if ($failed.Count -gt 0) {
        Write-Host ("Feilet:   {0}" -f $failed.Count) -ForegroundColor Red
    }
    else {
        Write-Host "Feilet:   0" -ForegroundColor Green
    }

    foreach ($name in $failed) {
        Write-Host ("  FEIL {0}" -f $name) -ForegroundColor Red
    }

    if ($failed.Count -gt 0) {
        throw ("{0} Edge Function(s) feilet under deploy." -f $failed.Count)
    }

    Write-Host ""
    Write-Host "Alle Edge Functions er deployet til Sverige." -ForegroundColor Green
}
finally {
    Pop-Location
}
