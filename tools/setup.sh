#!/usr/bin/env bash
# Fetches third-party libraries into ./vendor and generates app icons into ./icons.
# Run once before serving locally; the GitHub Pages / Netlify builds run it automatically.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
( cd "$tmp" && npm init -y >/dev/null && npm i --silent --no-audit --no-fund \
    pdfjs-dist@4.4.168 jszip@3.10.1 libarchive.js@2.0.2 mammoth@1.8.0 marked@12.0.2 )
N="$tmp/node_modules"
mkdir -p vendor
cp "$N/pdfjs-dist/build/pdf.min.mjs" "$N/pdfjs-dist/build/pdf.worker.min.mjs" vendor/
cp "$N/jszip/dist/jszip.min.js" "$N/mammoth/mammoth.browser.min.js" "$N/marked/marked.min.js" vendor/
cp "$N/libarchive.js/dist/libarchive.js" "$N/libarchive.js/dist/worker-bundle.js" "$N/libarchive.js/dist/libarchive.wasm" vendor/
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --quiet pillow
python3 tools/make_icons.py
rm -rf "$tmp"
echo "Done: vendor/ and icons/ are ready."
