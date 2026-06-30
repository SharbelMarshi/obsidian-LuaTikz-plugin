#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-1.3.5}"
ZIP_NAME="luatikz-${VERSION}.zip"

npm run build

rm -rf release
mkdir -p release
cp main.js release/main.js
cp manifest.json release/manifest.json
cp styles.css release/styles.css
cd release
zip -r "../${ZIP_NAME}" .
cd ..

gh release create "$VERSION" \
  main.js manifest.json styles.css \
  --title "LuaTikz ${VERSION}" \
  --notes "$(cat <<'EOF'
LuaTikz release with dual renderers and explicit local execution consent.

Obsidian Community Plugins install uses main.js, manifest.json, and styles.css.
TikZJax is bundled into main.js — no vendor folder is required.

- Local LuaLaTeX engine (recommended) with opt-in shell execution
- TikZJax renderer bundled for shell-free rendering
- One-time renderer installation notice
- RTL support for Hebrew and Arabic and Liquid Glass UI
EOF
)"

echo "Release ${VERSION} published with main.js, manifest.json, and styles.css. Optional local zip: ${ZIP_NAME}."
