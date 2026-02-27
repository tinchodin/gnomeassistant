#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/dist}"
UUID="gnomeassistant@tinchodin.uy"
ZIP_PATH="$OUT_DIR/$UUID.shell-extension.zip"

mkdir -p "$OUT_DIR"

echo "[1/3] Compiling GSettings schemas..."
glib-compile-schemas "$ROOT_DIR/schemas"

echo "[2/3] Building extension bundle..."
gnome-extensions pack "$ROOT_DIR" \
  --force \
  --out-dir "$OUT_DIR" \
  --schema="schemas/org.gnome.shell.extensions.gnomeassistant.gschema.xml" \
  --extra-source="README.md" \
  --extra-source="LICENSE"

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "Expected bundle not found: $ZIP_PATH" >&2
  exit 1
fi

echo "[3/3] Verifying bundle contents..."
unzip -l "$ZIP_PATH" | grep -q "metadata.json" || { echo "metadata.json missing in bundle" >&2; exit 1; }
unzip -l "$ZIP_PATH" | grep -q "extension.js" || { echo "extension.js missing in bundle" >&2; exit 1; }
unzip -l "$ZIP_PATH" | grep -q "schemas/org.gnome.shell.extensions.gnomeassistant.gschema.xml" || { echo "schema xml missing in bundle" >&2; exit 1; }

echo "Bundle ready: $ZIP_PATH"
