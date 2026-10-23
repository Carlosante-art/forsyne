# scripts/run_all.ps1
# Kor alla personas i sekvens och sammanfattar resultaten.
#
# Anvandning:
#   .\scripts\run_all.ps1           # dry-run (inga API-krediter)
#   .\scripts\run_all.ps1 -Live     # riktiga anrop

param(
    [switch]$Live
)

$ErrorActionPreference = "Stop"
$Root   = Split-Path $PSScriptRoot -Parent
$LogDir = Join-Path $Root "logs"

$Personas = @("athlete", "sedentary", "diabetic", "optimizer", "random")
$ModeLabel = if ($Live) { "LIVE" } else { "DRY-RUN" }

Write-Host ""
Write-Host "Praevictus - Simulator (alla personas)"
Write-Host "Lage     : $ModeLabel"
Write-Host "Personas : $($Personas -join ', ')"
Write-Host ""

# -- Kor varje persona i sekvens ----------------------------------------------

$RunResults = [ordered]@{}

foreach ($Persona in $Personas) {
    Write-Host "============================================"
    Write-Host "  Persona: $Persona"
    Write-Host "============================================"

    $NodeArgs = @("scripts/simulate.js", "--persona", $Persona)
    if ($Live) { $NodeArgs += "--live" }

    Push-Location $Root
    try {
        & node @NodeArgs
        $RunResults[$Persona] = $LASTEXITCODE
    } catch {
        Write-Warning "node kraschade for $Persona`: $_"
        $RunResults[$Persona] = 1
    } finally {
        Pop-Location
    }

    Write-Host ""

    # Vanta mellan personas for att undvika rate limit (30k tokens/minut)
    if ($Live -and $Personas.IndexOf($Persona) -lt $Personas.Count - 1) {
        Write-Host "  [rate limit] Vantar 60 sekunder innan nasta persona..."
        Start-Sleep -Seconds 60
        Write-Host ""
    }
}

# -- Bygg summary.json --------------------------------------------------------

Write-Host "============================================"
Write-Host "  Bygger summary.json..."
Write-Host "============================================"

if (-not (Test-Path $LogDir)) {
    Write-Warning "Ingen logs/-mapp hittad - hoppar over summary."
    exit 0
}

$AllErrors    = [System.Collections.Generic.List[string]]::new()
$PersonaStats = [System.Collections.Generic.List[object]]::new()

foreach ($Persona in $Personas) {
    # Senaste log-fil for persona (exkludera history- och onboarding-filer)
    $Files = Get-ChildItem -Path $LogDir -Filter "${Persona}_*.json" -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -notmatch "history|onboarding" } |
             Sort-Object Name -Descending

    if (-not $Files) {
        $PersonaStats.Add([ordered]@{
            persona = $Persona
            logg    = $null
            fel     = "Ingen logg hittad"
        })
        continue
    }

    $Latest  = $Files[0]
    try {
        $LogData = Get-Content $Latest.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        $PersonaStats.Add([ordered]@{
            persona = $Persona
            logg    = $Latest.Name
            fel     = "Kunde inte parsa JSON"
        })
        continue
    }

    $g = $LogData.gradering

    $PersonaStats.Add([ordered]@{
        persona          = $Persona
        logg             = $Latest.Name
        poang            = $g.poang
        generisk         = $g.generisk
        specifik         = $g.specifik
        prediktion       = $g.prediktion
        traffade         = $g.traffade
        forklaring       = $g.forklaring
        signal_aktiverad = $LogData.signal_aktiverad
        signal_dag       = $LogData.signal_dag
        notering         = $LogData.notering
        exit_kod         = $RunResults[$Persona]
        fel_antal        = $LogData.errors.Count
    })

    foreach ($Err in $LogData.errors) {
        $label = if ($Err.step) { $Err.step } elseif ($Err.error) { $Err.error } else { "okant" }
        $AllErrors.Add($label)
    }

    # Samla notering-text for monsteranalys
    if ($LogData.notering -and $LogData.notering -notmatch "DRY-RUN") {
        $AllErrors.Add("__notering__:$($LogData.notering)")
    }
}

# Tekniska fel - grupperade
$TekniskaFel = if (($AllErrors | Where-Object { $_ -notmatch "^__notering__" }).Count -gt 0) {
    $AllErrors | Where-Object { $_ -notmatch "^__notering__" } |
        Group-Object |
        Sort-Object Count -Descending |
        Select-Object -First 5 |
        ForEach-Object { [ordered]@{ fel = $_.Name; antal = $_.Count } }
} else { @() }

# Noteringar - samlade for monsteranalys
$Noteringar = $AllErrors |
    Where-Object { $_ -match "^__notering__:" } |
    ForEach-Object { $_ -replace "^__notering__:", "" }

# Gemensamma monster i noteringar - sokord som upprepas
$MonsterOrd = @("hallucin", "datum", "miss", "fel", "sakn", "kritisk", "period", "vecka", "dag")
$MonsterFynd = [System.Collections.Generic.List[object]]::new()
foreach ($Ord in $MonsterOrd) {
    $Treff = $Noteringar | Where-Object { $_ -match $Ord }
    if ($Treff.Count -gt 1) {
        $MonsterFynd.Add([ordered]@{ monster = $Ord; forekomster = $Treff.Count; exempel = ($Treff | Select-Object -First 1) })
    }
}

$VanligasteFel = @($TekniskaFel)

$Summary = [ordered]@{
    generated      = (Get-Date -Format "o")
    mode           = $ModeLabel.ToLower()
    personas       = $PersonaStats.ToArray()
    vanligaste_fel = @($VanligasteFel)
    noteringar     = @($Noteringar)
    monster        = @($MonsterFynd)
}

$SummaryPath = Join-Path $LogDir "summary.json"
$Summary | ConvertTo-Json -Depth 6 | Set-Content $SummaryPath -Encoding UTF8

# -- Tabell -------------------------------------------------------------------

Write-Host ""
Write-Host ("  {0,-13} {1,-6} {2,-10} {3,-10} {4,-12} {5}" -f "Persona", "Poang", "Generisk", "Specifik", "Prediktion", "Traffade")
Write-Host ("  " + ("-" * 62))

foreach ($P in $PersonaStats) {
    if ($P.fel) {
        Write-Host ("  {0,-13} {1}" -f $P.persona, $P.fel)
        continue
    }
    $poang = if ($null -ne $P.poang)     { "$($P.poang)/10" }  else { "-" }
    $gen   = if ($null -ne $P.generisk)  { if ($P.generisk)  { "FAIL" } else { "ok" } } else { "-" }
    $spe   = if ($null -ne $P.specifik)  { if ($P.specifik)   { "ok" } else { "fail" } } else { "-" }
    $pre   = if ($null -ne $P.prediktion){ if ($P.prediktion)  { "ok" } else { "fail" } } else { "-" }
    $tra   = if ($null -ne $P.traffade)  { if ($P.traffade)   { "JA" } else { "NEJ" } }  else { "-" }
    Write-Host ("  {0,-13} {1,-6} {2,-10} {3,-10} {4,-12} {5}" -f $P.persona, $poang, $gen, $spe, $pre, $tra)
}

Write-Host ""

if ($VanligasteFel) {
    Write-Host "  Tekniska fel:"
    foreach ($F in $VanligasteFel) {
        Write-Host ("    {0,-30} x{1}" -f $F.fel, $F.antal)
    }
    Write-Host ""
}

if ($MonsterFynd.Count -gt 0) {
    Write-Host "  Gemensamma monster i noteringar:"
    foreach ($M in $MonsterFynd) {
        Write-Host ("    [{0}] x{1} - {2}" -f $M.monster, $M.forekomster, $M.exempel.Substring(0, [Math]::Min(80, $M.exempel.Length)))
    }
    Write-Host ""
}

Write-Host "  Summary: $SummaryPath"
Write-Host ""
