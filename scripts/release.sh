#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="1.1.0"

npm run build

gh release create "$VERSION" \
  main.js manifest.json styles.css \
  vendor/ \
  --title "LuaTikZ $VERSION" \
  --notes "$(cat <<'EOF'
LuaTikZ release with dual renderers and explicit local execution consent.

- Local LuaLaTeX engine (recommended) with opt-in shell execution
- TikZJax renderer bundled under vendor/node-tikzjax and vendor/tex
- One-time renderer installation notice
- RTL support, Liquid Glass UI, opt-in clipboard copy
- GitHub artifact attestations for main.js, manifest.json, styles.css, and TikZJax entry
EOF
)"

echo "Release $VERSION published."
