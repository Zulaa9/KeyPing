$ErrorActionPreference = 'Stop'

# Paths and release signing key configuration.
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$buildDir = Join-Path $projectRoot 'dist/build'
$checksumsFileName = 'SHA256SUMS.txt'
$signatureFileName = 'SHA256SUMS.txt.asc'
$checksumsPath = Join-Path $buildDir $checksumsFileName
$gpgKeyFingerprint = 'D70937B0AD7411A9E6A66337A5F10A1A37AAEBE9'

# Release artifacts to hash.
$allowedExtensions = @('.exe', '.AppImage', '.dmg')
$ignoredFileNames = @(
  'latest.yml',
  $checksumsFileName,
  $signatureFileName
)

if (-not (Test-Path $buildDir)) {
  Write-Warning "Build directory not found: $buildDir"
  exit 0
}

# Collect release binaries from dist/build and keep deterministic ordering.
$releaseFiles =
  Get-ChildItem -Path $buildDir -File |
  Where-Object {
    $allowedExtensions -contains $_.Extension -and
    $ignoredFileNames -notcontains $_.Name -and
    -not $_.Name.EndsWith('.blockmap')
  } |
  Sort-Object Name

# Build standard checksum lines: HASH<space><space>filename
$lines = @()
foreach ($file in $releaseFiles) {
  $hash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash
  $lines += "$hash  $($file.Name)"
}

# Save checksum manifest in ASCII for broad tooling compatibility.
Set-Content -Path $checksumsPath -Value $lines -Encoding ascii
Write-Host "Generated $checksumsPath with $($releaseFiles.Count) entr$(if ($releaseFiles.Count -eq 1) { 'y' } else { 'ies' })."

if (-not (Test-Path $checksumsPath)) {
  Write-Warning "Checksum file not found, skipping signature: $checksumsPath"
  exit 0
}

# Ensure GPG is available before trying to sign.
if (-not (Get-Command gpg -ErrorAction SilentlyContinue)) {
  throw "GPG is not installed or not available in PATH. Install GnuPG to generate $signatureFileName."
}

# Sign from inside dist/build so output uses local filenames and expected release layout.
Push-Location $buildDir
try {
  if (Test-Path $signatureFileName) {
    Remove-Item $signatureFileName -Force
  }

  & gpg --batch --yes --local-user $gpgKeyFingerprint --armor --detach-sign $checksumsFileName

  if (-not (Test-Path $signatureFileName)) {
    throw "Failed to generate $signatureFileName."
  }

  Write-Host "Generated signature: $(Join-Path $buildDir $signatureFileName)"
}
finally {
  Pop-Location
}
