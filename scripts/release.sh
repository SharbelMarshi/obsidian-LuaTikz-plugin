#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-1.3.2}"
ZIP_NAME="luatikz-${VERSION}.zip"

npm run build

rm -rf release
mkdir -p release/tikzjax-tex
cp main.js release/main.js
cp tikzjax.js release/tikzjax.js
cp manifest.json release/manifest.json
cp styles.css release/styles.css
cp -R tikzjax-tex/. release/tikzjax-tex/
cd release
zip -r "../${ZIP_NAME}" .
cd ..

gh release create "$VERSION" \
  main.js \
  tikzjax.js \
  manifest.json \
  styles.css \
  tikzjax-tex/core.dump.gz \
  tikzjax-tex/tex.wasm.gz \
  tikzjax-tex/tex_files.tar.gz \
  tikzjax-tex/.luatikz-tex-hash \
  "${ZIP_NAME}" \
  --title "LuaTikz ${VERSION}" \
  --notes "$(cat <<'EOF'
LuaTikz release with dual renderers and explicit local execution consent.

Obsidian Community Plugins install uses main.js, tikzjax.js, manifest.json, styles.css, and the tikzjax-tex runtime files.
TikZJax is bundled offline — no vendor folder is required.

- Local LuaLaTeX engine (recommended) with opt-in shell execution
- TikZJax renderer bundled for shell-free rendering
- One-time renderer installation notice
- RTL support, Liquid Glass UI, opt-in clipboard copy
EOF
)"

echo "Release ${VERSION} published with Obsidian assets and ${ZIP_NAME}."
