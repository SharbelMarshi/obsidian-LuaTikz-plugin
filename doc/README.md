# LuaTikZ Documentation

**LuaTikZ** is a local LuaLaTeX-based TikZ renderer for Obsidian. Write TikZ diagrams in your notes, compile them on your machine, and view crisp SVG output—no external services required.

## Documentation index

| Document | Description |
|----------|-------------|
| [Getting started](getting-started.md) | Installation, requirements, and your first diagram |
| [Simple shape helpers](simple-shape-helpers.md) | Built-in drawing macros (`\Circle`, `\ANDgate`, etc.) |
| [Commands & autocompletion](commands.md) | Palette commands, TikZ commands, and editor snippets |
| [Autocompletion](autocompletion.md) | How suggestions work inside `tikz` blocks |
| [RTL, English & math](rtl-and-math.md) | Hebrew text, labels, and formulas |
| [Rendering & export](rendering-and-export.md) | SVG output, export buttons, and live preview |
| [Error mapping](error-mapping.md) | Line-aware LaTeX error messages |
| [Settings](settings.md) | Plugin options and defaults |
| [Scaling diagrams](scaling.md) | Scaling tikzpictures and logic gates |

## Quick example

Create a fenced `tikz` code block in any note:

````markdown
```tikz
\begin{tikzpicture}
\Text(0,0,Hello)
\Text(0,-1,\he{שלום עולם})
\Text(0,-2,{$V_G=\frac{Q}{C}$})
\end{tikzpicture}
```
````

The plugin wraps your code in a full LuaLaTeX document, compiles locally, and embeds the result as SVG.

## Feature overview

- **Local rendering** — LuaLaTeX + `pdftocairo` on your Mac; source never leaves your machine
- **Auto preamble** — No need for `\documentclass`, `\usepackage`, or `\begin{document}`
- **Simple shape helpers** — Quick macros for lines, shapes, gates, and circuit symbols
- **Autocompletion** — TikZ commands, helpers, math symbols, and snippet blocks with cursor placement
- **RTL support** — `\he{...}` for Hebrew with correct font and direction
- **Live preview** — Floating preview while editing inside a TikZ block
- **Export** — Download or copy SVG from rendered blocks
- **Line-aware errors** — LaTeX errors mapped back to your TikZ block line numbers
- **Dark mode** — Optional color inversion so diagrams stay readable

## Project layout

```
obsidianlualatex/
├── main.ts              # Core plugin (rendering, preview, export)
├── simpleShapes.ts      # Built-in TikZ helper macros
├── latexAutocomplete.ts # Editor autocompletion
├── latexErrorMapping.ts # Error line mapping
├── settings.ts          # Settings UI
├── styles.css           # Plugin styling
├── manifest.json        # Obsidian plugin metadata
└── doc/                 # This documentation
```

## Build & install

```bash
npm install
npm run build
```

Copy the plugin folder (including `main.js`, `manifest.json`, and `styles.css`) into your vault's `.obsidian/plugins/luatikz/` directory, then enable **LuaTikZ** in Obsidian settings.

## Requirements

| Tool | Purpose | Typical location (macOS) |
|------|---------|--------------------------|
| **LuaLaTeX** | Compiles TikZ to PDF | `/Library/TeX/texbin/lualatex` |
| **pdftocairo** | Converts PDF to SVG | `brew install poppler` |
| **David CLM** (optional) | Hebrew font | Usually bundled with Hebrew TeX setups |

Verify in Terminal:

```bash
which lualatex
which pdftocairo
```
