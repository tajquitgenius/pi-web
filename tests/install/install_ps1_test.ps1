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

Remove-Item Env:PI_WEB_INSTALLER_TEST
Write-Host 'PASS: install.ps1 semver release selection'
