# Rendering & export

## How rendering works

1. Your `tikz` code block source is cleaned (empty lines trimmed, `&nbsp;` removed)
2. The plugin wraps it in a full LuaLaTeX document (see [Getting started](getting-started.md))
3. **LuaLaTeX** compiles to PDF in a temporary directory
4. **pdftocairo** converts PDF to SVG
5. SVG is embedded in the note as a `data:` URL (base64)

Rendering happens:

- When viewing a note in **Reading view** or **Live Preview** (code block processor)
- When **inline live preview** is enabled and the cursor is in a TikZ block

## Rendered block UI

Successful renders show:

- The diagram (SVG image, scales to note width)
- **Export SVG** — downloads `tikz-diagram.svg`
- **Copy SVG** — copies raw SVG text to the clipboard

Toolbar appears above the diagram in reading/preview mode.

## Inline live preview

A floating panel in the editor (top-right) shows the diagram for the TikZ block your cursor is in.

| Behavior | Detail |
|----------|--------|
| **Enable** | Command palette → *LuaTikZ: Toggle inline live preview* |
| **Default** | Can be enabled on startup via [Settings](settings.md) |
| **Debounce** | Re-renders ~800ms after you stop typing |
| **Stale on error** | If compile fails, last good diagram may stay visible with an error message below |

Inline preview does not include the export toolbar (export from the rendered block in reading view).

## Dark mode color inversion

When **Invert dark colors in dark mode** is enabled (default), black strokes and fills in SVG are converted to white while Obsidian uses a dark theme. This keeps axes, arrows, and gate outlines visible.

Toggle in **Settings → LuaTikZ**.

## Output format

Diagrams are **SVG** for sharp scaling in notes and exports. The plugin does not write PNG or PDF into your vault automatically—use **Export SVG** and convert externally if needed.

## Performance notes

- Each render spawns LuaLaTeX in a temp folder; complex diagrams may take a few seconds
- Inline preview skips re-render if source unchanged since last success
- Concurrent edits cancel outdated preview requests (token-based)

## Dependencies

| Tool | Role |
|------|------|
| `lualatex` | TikZ → PDF |
| `pdftocairo` | PDF → SVG |

Error messages include install hints if either tool is missing.
