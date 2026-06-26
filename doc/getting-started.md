# Getting started

## What you need

1. **Obsidian** (desktop; this plugin is desktop-only)
2. **MacTeX or TeX Live** with LuaLaTeX
3. **Poppler** (`pdftocairo`) for SVG conversion:

```bash
brew install poppler
```

## Install the plugin

1. Build the project: `npm run build`
2. Copy these files into `.obsidian/plugins/luatikz/` in your vault:
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. Enable **LuaTikZ** under **Settings → Community plugins**

## Your first diagram

In any note, create a code block with language `tikz`:

````markdown
```tikz
\begin{tikzpicture}
\draw[->] (0,0) -- (2,0);
\node at (1,0.3) {Hello};
\end{tikzpicture}
```
````

Switch to **Reading view** to see the rendered diagram. In **Live Preview**, the block renders inline.

## What to write (and what to skip)

**Write only the diagram body.** The plugin automatically adds:

- `\documentclass{standalone}` with TikZ
- Font and language packages (`fontspec`, `polyglossia`)
- TikZ libraries (`arrows.meta`, logic gates, etc.)
- All simple shape helper macros
- `\begin{document}` … `\end{document}`

You do **not** need to repeat `\usepackage{tikz}` or similar unless you use extra libraries not in the default preamble.

## Code block vs live preview

| Mode | Where it appears |
|------|------------------|
| **Reading view / Live Preview** | Diagram renders inside the note where the code block is |
| **Inline live preview** | Floating panel while your cursor is inside a `tikz` block in the editor |

Toggle inline preview: **Command palette → LuaTikZ: Toggle inline live preview**

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "LuaLaTeX was not found" | Install MacTeX; check `which lualatex` |
| "SVG conversion is not available" | Run `brew install poppler` |
| Blank or stale diagram | Re-open the note or toggle Reading/Live Preview |
| Hebrew shows as boxes | Ensure David CLM (or another Hebrew font) is installed |

See [Error mapping](error-mapping.md) for compile error help and [Rendering & export](rendering-and-export.md) for output options.
