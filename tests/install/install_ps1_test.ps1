$ErrorActionPreference = 'Stop'
$env:PI_WEB_INSTALLER_TEST = '1'
. (Join-Path $PSScriptRoot '..\..\install.ps1')

function Assert-Comparison($left, $right, $want) {
  $actual = Compare-SemVer $left $right
  if ([Math]::Sign($actual) -ne [Math]::Sign($want)) {
    throw "Compare-SemVer $left $right returned $actual; expected sign $want"
  }
}

Assert-Comparison 'v1.0.0' 'v1.0.0-beta.9' 1
Assert-Comparison 'v1.0.0-beta.10' 'v1.0.0-beta.2' 1
Assert-Comparison 'v2.0.0-beta.1' 'v1.9.9' 1
Assert-Comparison 'v1.0.0-alpha' 'v1.0.0-alpha' 0

function Invoke-RestMethod {
  param([string]$Uri)
  if ($Uri -notlike '*releases?per_page=100') {
    throw "Unexpected release URL: $Uri"
  }
  return @(
    [pscustomobject]@{ tag_name = 'v9.9.9'; draft = $false },
    [pscustomobject]@{ tag_name = 'v10.0.0-beta.1'; draft = $false },
    [pscustomobject]@{ tag_name = 'v11.0.0'; draft = $true }
  )
}

$latest = Get-LatestTag
if ($latest -ne 'v10.0.0-beta.1') {
  throw "Get-LatestTag returned $latest; expected v10.0.0-beta.1"
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("pi-web-installer-test-" + [guid]::NewGuid())
$script:ConfigDir = Join-Path $testRoot '.config\pi-web'
$script:EnvFile = Join-Path $ConfigDir 'env'
try {
  Remove-Item Env:PI_WEB_TOKEN -ErrorAction SilentlyContinue
  Initialize-EnvFile
  if (Select-String -Path $EnvFile -Pattern '^PI_WEB_TOKEN=' -Quiet) {
    throw 'Initialize-EnvFile generated PI_WEB_TOKEN without an explicit value'
  }

  Set-Content -Path $EnvFile -Value @('PI_WEB_TOKEN=existing-secret', 'KEEP=value')
  Initialize-EnvFile
  if (-not (Select-String -Path $EnvFile -SimpleMatch 'PI_WEB_TOKEN=existing-secret' -Quiet)) {
    throw 'Initialize-EnvFile did not preserve the existing token'
  }

  $env:PI_WEB_TOKEN = 'explicit-secret'
  $output = Initialize-EnvFile | Out-String
  if (-not (Select-String -Path $EnvFile -SimpleMatch 'PI_WEB_TOKEN=explicit-secret' -Quiet)) {
    throw 'Initialize-EnvFile did not persist the explicit token'
  }
  if ($output -match 'explicit-secret') {
    throw 'Initialize-EnvFile printed the explicit token'
  }
} finally {
  Remove-Item Env:PI_WEB_TOKEN -ErrorAction SilentlyContinue
  Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item Env:PI_WEB_INSTALLER_TEST
}

Write-Host 'PASS: install.ps1 release selection and optional token handling'
