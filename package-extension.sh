#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$DIR/extension"
DIST_DIR="$DIR/dist"
ZIP_NAME="qwik-mobile-preview-v1.0.0.zip"
OUTPUT_ZIP="$DIST_DIR/$ZIP_NAME"

echo "============================================="
echo "📦 Packaging Qwik Mobile Preview for Chrome Web Store"
echo "============================================="

# Ensure dist directory exists
mkdir -p "$DIST_DIR"
rm -f "$OUTPUT_ZIP"

# Navigate to extension directory so manifest.json is at zip root
cd "$EXT_DIR"

# Clean any OS artifacts
find . -name ".DS_Store" -delete

# Create clean ZIP without hidden files
zip -r -q -9 "$OUTPUT_ZIP" . \
  -x "*.DS_Store" \
  -x "__MACOSX*" \
  -x "*.git*"

cd "$DIR"

echo "✅ Package created successfully!"
echo "📁 File: $OUTPUT_ZIP"
echo "⚖️  Size: $(ls -lh "$OUTPUT_ZIP" | awk '{print $5}')"
echo ""
echo "Verification:"
unzip -l "$OUTPUT_ZIP"
echo ""
echo "👉 Ready to upload to Chrome Developer Dashboard: https://chrome.google.com/webstore/devconsole/"
