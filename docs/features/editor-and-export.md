# Editor assistance and export

## Editor

Inside `tikz` / `luatikz` blocks (and standalone `\begin{tikzpicture}` environments):

- Line numbers on every line, including blanks
- Active-line and matching `\begin`/`\end` pair highlights
- Structural lint: unmatched environments/braces, missing libraries, rewritten `\usetikzlibrary` names, empty option keys
- New fences can auto-insert a blank `tikzpicture` skeleton
- Semicolon reminder on unfinished `\draw` lines (hint or auto-append)
- Auto-close `{`, `[`, `(`, `$`

**Command palette**

| Command | What it does |
|---------|----------------|
| Open helper reference | Searchable cheat sheet; click to insert |
| Insert TikZ template… | Blank picture, flowchart, axis, logic circuit |
| Format TikZ block | Tidy indentation inside the fence |
| Wrap selection in `\node{}` / `$...$` | |
| Insert plot from function… | PGFPlots wizard |
| What can I use here? | Pick a snippet category |

## Export

Hover a rendered block and click **Export** to save the diagram as SVG. The arrow next to it opens a menu to choose **SVG** or **PNG**; PNG is rasterized from the vector output at 2× so it stays crisp.

