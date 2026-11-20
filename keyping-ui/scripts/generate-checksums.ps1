$ErrorActionPreference = 'Stop'

# Paths and release signing key configuration.
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$buildDir = Join-Path $projectRoot 'dist/build'
$checksumsFileName = 'SHA256SUMS.txt'
$signatureFileName = 'SHA256SUMS.txt.asc'
$checksumsPath = Join-Path $buildDir $checksumsFileName
$gpgKeyFingerprint = 'D70937B0AD7411A9E6A66337A5F10A1A37AAEBE9'
$gpgCandidatePaths = @(
  'C:\Program Files\GnuPG\bin\gpg.exe',
  'C:\Program Files (x86)\GnuPG\bin\gpg.exe',
  'C:\Program Files\Git\usr\bin\gpg.exe',
  'C:\Program Files\Git\mingw64\bin\gpg.exe'
)

# Release artifacts to hash.
$allowedExtensions = @('.exe', '.AppImage', '.dmg', '.apk')
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

# Resolve GPG from PATH or common Windows install paths.
$gpgCommand = Get-Command gpg -ErrorAction SilentlyContinue
$gpgExecutable = if ($gpgCommand) { $gpgCommand.Source } else { $null }
if (-not $gpgExecutable) {
  $gpgExecutable = $gpgCandidatePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $gpgExecutable) {
  Write-Warning "GPG not found, skipping $signatureFileName."
  exit 0
}

# Signing is optional: skip it when the release key is not in the local keyring.
# gpg reports a missing key on stderr, which must not abort the script under 'Stop'.
$ErrorActionPreference = 'Continue'
& $gpgExecutable --list-secret-keys $gpgKeyFingerprint *> $null
$gpgKeyExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($gpgKeyExitCode -ne 0) {
  Write-Warning "GPG key $gpgKeyFingerprint not found, skipping $signatureFileName."
  exit 0
}

# Sign from inside dist/build so output uses local filenames and expected release layout.
Push-Location $buildDir
try {
  if (Test-Path $signatureFileName) {
    Remove-Item $signatureFileName -Force
  }

  & $gpgExecutable --batch --yes --local-user $gpgKeyFingerprint --armor --detach-sign $checksumsFileName

  if (-not (Test-Path $signatureFileName)) {
    throw "Failed to generate $signatureFileName."
  }

  Write-Host "Generated signature: $(Join-Path $buildDir $signatureFileName)"
}
finally {
  Pop-Location
}
