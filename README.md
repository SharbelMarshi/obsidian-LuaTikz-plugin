# LuaTikZ Plugin for Obsidian

**LuaTikZ** renders TikZ diagrams locally in Obsidian using LuaLaTeX. Write `tikz` code blocks in your notes—no external services, with RTL (Hebrew) support, autocompletion, live preview, SVG export, and line-aware errors.

## Quick start

````markdown
```tikz
\begin{tikzpicture}
\Text(0,0,Hello)
\Text(0,-1,\he{שלום עולם})
\Arrow(0,-2,2,-2)
\end{tikzpicture}
```
````

## Requirements

- macOS desktop Obsidian
- LuaLaTeX (MacTeX / TeX Live)
- `pdftocairo` — `brew install poppler`

## Build

```bash
npm install
npm run build
```

Install `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/luatikz/`.

## Documentation

Full documentation lives in the **[doc/](doc/)** directory:

| Guide | Topic |
|-------|--------|
| [doc/README.md](doc/README.md) | Overview & index |
| [doc/getting-started.md](doc/getting-started.md) | Install & first diagram |
| [doc/simple-shape-helpers.md](doc/simple-shape-helpers.md) | `\Circle`, `\ANDgate`, wires, etc. |
| [doc/commands.md](doc/commands.md) | Palette & TikZ commands |
| [doc/autocompletion.md](doc/autocompletion.md) | Editor snippets & suggestions |
| [doc/rtl-and-math.md](doc/rtl-and-math.md) | Hebrew, English, math |
| [doc/rendering-and-export.md](doc/rendering-and-export.md) | SVG, export, live preview |
| [doc/error-mapping.md](doc/error-mapping.md) | Line-aware compile errors |
| [doc/settings.md](doc/settings.md) | Plugin settings |
| [doc/scaling.md](doc/scaling.md) | Scaling diagrams & logic gates |

## Features

- Local LuaLaTeX rendering with automatic preamble wrapping
- Simple shape helpers for fast diagrams
- Autocompletion with cursor-aware snippets
- Inline live preview
- Export / copy SVG from rendered blocks
- Line-aware LaTeX error mapping
- Dark mode color inversion
