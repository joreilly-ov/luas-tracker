Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$generatedDir = Join-Path $repoRoot "docs/generated"
New-Item -ItemType Directory -Force -Path $generatedDir | Out-Null

$nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$gitSha = "unknown"
try {
    $gitSha = (git rev-parse --short HEAD).Trim()
} catch {
    $gitSha = "unknown"
}

$pythonExe = Join-Path $repoRoot ".venv/Scripts/python.exe"
if (-not (Test-Path $pythonExe)) {
    $pythonExe = "python"
}

function Write-OpenApiFromApp {
    param(
        [Parameter(Mandatory = $true)]
        [string]$servicePath,
        [Parameter(Mandatory = $true)]
        [string]$outputPath,
        [Parameter(Mandatory = $true)]
        [string]$pythonCommand
    )

    $script = @"
import json
import pathlib
import sys

from fastapi import FastAPI

service_path = pathlib.Path(r'''$servicePath''').resolve()
sys.path.insert(0, str(service_path))

from routes import router

app = FastAPI(title="Generated API", version="generated")
app.include_router(router)

print(json.dumps(app.openapi(), indent=2))
"@

    $scriptFile = Join-Path $env:TEMP ("openapi_" + [Guid]::NewGuid().ToString() + ".py")
    Set-Content -Path $scriptFile -Value $script -Encoding UTF8
    try {
        $json = & $pythonCommand $scriptFile
        Set-Content -Path $outputPath -Value $json -Encoding UTF8
    } finally {
        Remove-Item -Path $scriptFile -ErrorAction SilentlyContinue
    }
}

function Add-ApiSection {
    param(
        [Parameter(Mandatory = $true)]
        [System.Text.StringBuilder]$sb,
        [Parameter(Mandatory = $true)]
        [string]$title,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$openApi
    )

    [void]$sb.AppendLine("## $title")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("- API title: $($openApi.info.title)")
    [void]$sb.AppendLine("- API version: $($openApi.info.version)")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("### Endpoints")
    [void]$sb.AppendLine("")

    foreach ($pathProp in $openApi.paths.PSObject.Properties | Sort-Object Name) {
        $pathName = $pathProp.Name
        $pathItem = $pathProp.Value
        foreach ($methodProp in $pathItem.PSObject.Properties | Sort-Object Name) {
            $method = $methodProp.Name.ToUpper()
            $op = $methodProp.Value
            $summary = if ($op.summary) { $op.summary } else { "No summary" }
            [void]$sb.AppendLine("- **$method $pathName** - $summary")

            $hasParameters = $null -ne $op.PSObject.Properties["parameters"] -and $null -ne $op.parameters
            if ($hasParameters) {
                foreach ($p in $op.parameters) {
                    $required = if ($p.required) { "required" } else { "optional" }
                    [void]$sb.AppendLine("  - param $($p.name) ($($p.in), $required)")
                }
            }
        }
    }
    [void]$sb.AppendLine("")
}

function Add-TestResultSection {
    param(
        [Parameter(Mandatory = $true)]
        [System.Text.StringBuilder]$sb,
        [Parameter(Mandatory = $true)]
        [string]$title,
        [Parameter(Mandatory = $true)]
        [int]$exitCode,
        [Parameter(Mandatory = $true)]
        [string]$logPath
    )

    $status = if ($exitCode -eq 0) { "PASS" } else { "FAIL" }
    [void]$sb.AppendLine("- **${title}:** $status (exit code: $exitCode)")
    [void]$sb.AppendLine("  - Log: $logPath")
}

function Get-FrontendRoutes {
    param(
        [Parameter(Mandatory = $true)]
        [string]$appFilePath
    )

    $text = Get-Content -Path $appFilePath -Raw
    $matches = [regex]::Matches($text, '<Route\s+path="([^"]+)"\s+element=\{<([^\s/>]+)\s*/?>\}\s*/?>')

    $routes = @()
    foreach ($m in $matches) {
        $routes += [pscustomobject]@{
            path = $m.Groups[1].Value
            component = $m.Groups[2].Value
        }
    }
    return $routes
}

$luasOpenApiPath = Join-Path $generatedDir "luas-openapi.json"
$dartOpenApiPath = Join-Path $generatedDir "dart-openapi.json"

Write-OpenApiFromApp -servicePath (Join-Path $repoRoot "backend") -outputPath $luasOpenApiPath -pythonCommand $pythonExe
Write-OpenApiFromApp -servicePath (Join-Path $repoRoot "dart-service") -outputPath $dartOpenApiPath -pythonCommand $pythonExe

$backendTestLog = Join-Path $generatedDir "backend-tests.txt"
$dartTestLog = Join-Path $generatedDir "dart-service-tests.txt"
$frontendTestLog = Join-Path $generatedDir "frontend-tests.txt"

$backendExit = 0
$dartExit = 0
$frontendExit = 0

Push-Location (Join-Path $repoRoot "backend")
try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $backendOutput = & $pythonExe -m pytest -q 2>&1
    $backendExit = $LASTEXITCODE
    Set-Content -Path $backendTestLog -Value ($backendOutput -join [Environment]::NewLine) -Encoding UTF8
    $ErrorActionPreference = $prevEap
} finally {
    Pop-Location
}

Push-Location (Join-Path $repoRoot "dart-service")
try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $dartOutput = & $pythonExe -m pytest -q 2>&1
    $dartExit = $LASTEXITCODE
    Set-Content -Path $dartTestLog -Value ($dartOutput -join [Environment]::NewLine) -Encoding UTF8
    $ErrorActionPreference = $prevEap
} finally {
    Pop-Location
}

Push-Location (Join-Path $repoRoot "frontend")
try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $frontendOutput = & npm run test 2>&1
    $frontendExit = $LASTEXITCODE
    Set-Content -Path $frontendTestLog -Value ($frontendOutput -join [Environment]::NewLine) -Encoding UTF8
    $ErrorActionPreference = $prevEap
} finally {
    Pop-Location
}

$luasOpenApi = Get-Content -Path $luasOpenApiPath -Raw | ConvertFrom-Json
$dartOpenApi = Get-Content -Path $dartOpenApiPath -Raw | ConvertFrom-Json
$frontendRoutes = Get-FrontendRoutes -appFilePath (Join-Path $repoRoot "frontend/src/App.tsx")

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# User Documentation (Generated)")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("This file is generated from executable code and test runs, not handwritten notes.")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("- Generated at (UTC): $nowIso")
[void]$sb.AppendLine("- Git commit: $gitSha")
[void]$sb.AppendLine("")

[void]$sb.AppendLine("## Frontend Routes")
[void]$sb.AppendLine("")
foreach ($r in $frontendRoutes) {
    $routePath = $r.path
    if ($routePath -eq "*") {
        $routePath = "\*"
    }
    [void]$sb.AppendLine("- **$routePath** -> $($r.component)")
}
[void]$sb.AppendLine("")

Add-ApiSection -sb $sb -title "Luas Backend API" -openApi $luasOpenApi
Add-ApiSection -sb $sb -title "DART Service API" -openApi $dartOpenApi

[void]$sb.AppendLine("## Test Verification")
[void]$sb.AppendLine("")
Add-TestResultSection -sb $sb -title "Backend pytest" -exitCode $backendExit -logPath "docs/generated/backend-tests.txt"
Add-TestResultSection -sb $sb -title "DART service pytest" -exitCode $dartExit -logPath "docs/generated/dart-service-tests.txt"
Add-TestResultSection -sb $sb -title "Frontend vitest" -exitCode $frontendExit -logPath "docs/generated/frontend-tests.txt"
[void]$sb.AppendLine("")

[void]$sb.AppendLine("## Notes")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("- Source of truth for APIs: OpenAPI generated from FastAPI app objects.")
[void]$sb.AppendLine("- Source of truth for UI routes: parsed from frontend/src/App.tsx.")
[void]$sb.AppendLine("- Source of truth for behavior checks: test command exit codes and logs.")

$userGuidePath = Join-Path $repoRoot "docs/USER_GUIDE.generated.md"
Set-Content -Path $userGuidePath -Value $sb.ToString() -Encoding UTF8

Write-Host "Generated files:"
Write-Host "- docs/USER_GUIDE.generated.md"
Write-Host "- docs/generated/luas-openapi.json"
Write-Host "- docs/generated/dart-openapi.json"
Write-Host "- docs/generated/backend-tests.txt"
Write-Host "- docs/generated/dart-service-tests.txt"
Write-Host "- docs/generated/frontend-tests.txt"

if ($backendExit -ne 0 -or $dartExit -ne 0 -or $frontendExit -ne 0) {
    Write-Warning "One or more test suites failed. Generated docs include failure status."
    exit 1
}

exit 0