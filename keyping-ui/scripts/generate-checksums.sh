#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/../dist/build"
CHECKSUMS_FILE="SHA256SUMS.txt"
SIGNATURE_FILE="SHA256SUMS.txt.asc"
GPG_KEY="D70937B0AD7411A9E6A66337A5F10A1A37AAEBE9"

if [ ! -d "$BUILD_DIR" ]; then
  echo "Build directory not found: $BUILD_DIR"
  exit 0
fi

cd "$BUILD_DIR"

# Collect release binaries and generate SHA256 checksums.
find . -maxdepth 1 -type f \( -name "*.AppImage" -o -name "*.exe" -o -name "*.dmg" \) \
  ! -name "*.blockmap" \
  ! -name "$CHECKSUMS_FILE" \
  ! -name "$SIGNATURE_FILE" \
  ! -name "latest*.yml" \
  | sort | xargs -I{} bash -c 'sha256sum "$1" | sed "s|\./||"' _ {} > "$CHECKSUMS_FILE"

COUNT=$(wc -l < "$CHECKSUMS_FILE")
echo "Generated $CHECKSUMS_FILE with $COUNT entries."

# Sign if GPG key is available.
if gpg --list-secret-keys "$GPG_KEY" &>/dev/null; then
  rm -f "$SIGNATURE_FILE"
  gpg --batch --yes --local-user "$GPG_KEY" --armor --detach-sign "$CHECKSUMS_FILE"
  echo "Generated signature: $BUILD_DIR/$SIGNATURE_FILE"
else
  echo "GPG key not found, skipping signature."
fi
