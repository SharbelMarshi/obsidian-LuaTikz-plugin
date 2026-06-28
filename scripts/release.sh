#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="1.0.1"

npm run build

gh release create "$VERSION" \
  main.js manifest.json styles.css \
  --title "LuaTikZ $VERSION" \
  --notes "$(cat <<'EOF'
Initial release.

- Local TikZ rendering via LuaLaTeX + pdftocairo (SVG output)
- Live inline preview while editing `tikz` blocks
- RTL / Hebrew support via `\he{...}`
- Built-in diagram helpers, autocomplete, SVG export/copy
- Line-aware LaTeX errors and optional dark-mode color inversion

Requires macOS desktop Obsidian, LuaLaTeX, and `pdftocairo` (`brew install poppler`).
EOF
)"

echo "Release $VERSION published."
