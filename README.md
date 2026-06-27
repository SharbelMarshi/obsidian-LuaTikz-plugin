# LuaTikZ

Fast rendering `tikz` code blocks with **local LuaLaTeX** with full library supprot of lualatex

## What it supports

**Full LuaLaTeX.** If a package or TikZ library is installed in your TeX distribution, you can use it — load extra TikZ libraries with `\usetikzlibrary{...}`, use pgfplots axes, circuitikz, math mode, and normal LaTeX commands. The default preamble already includes common libraries (`arrows.meta`, `positioning`, `calc`, `shapes`, logic gates, etc.).

**Live preview.** While editing inside a `tikz` block, a floating preview updates as you type. Toggle it from the command palette: *Toggle inline live preview*.

**Built-in helpers.** Short macros for quick diagrams — `\Circle`, `\Arrow`, `\Rect`, logic gates (`\ANDgate`, `\NOTgate`, …), wires, and basic circuit symbols. Autocomplete inside `tikz` blocks suggests TikZ commands, helpers, and snippets.

**Export.** Rendered blocks get *Export SVG* and *Copy SVG* buttons on hover.

**RTL and Hebrew.** Use `\he{...}` for Hebrew labels and mixed Hebrew/English diagrams. Polyglossia and a Hebrew font are configured in the wrapper.

**Errors mapped to your note.** LaTeX compile errors are mapped back to the line in your TikZ block (and note line when using live preview).

**Dark mode.** Optional color inversion so black diagram strokes stay visible on dark themes.

## Requirements

-  desktop Obsidian
-  LuaLaTeX MacTeX or TeX Live (`which lualatex`)
- `pdftocairo` for PDF → SVG- `brew install poppler`

Hebrew text works best if David CLM (or another Hebrew font) is available to LuaLaTeX.

Enable **LuaTikZ** under Settings → Community plugins.

## Example

```tikz
\begin{tikzpicture}
\Text(0,0,Hello)
\Text(0,-1,\he{שלום עולם})
\Arrow(0,-2,2,-2)
\ANDgate(4,-2,and1)
\end{tikzpicture}
```

Reading view renders the block inline. In the editor, place the cursor inside the block for live preview.

### pgfplots

```tikz
\begin{tikzpicture}
\begin{axis}[width=8cm, height=5cm]
\addplot {sin(deg(x))};
\end{axis}
\end{tikzpicture}
```

### Extra TikZ libraries

```tikz
\usetikzlibrary{patterns}
\begin{tikzpicture}
\draw[pattern=north east lines] (0,0) rectangle (2,1);
\end{tikzpicture}
```

## Settings

- **Invert colors in dark mode** — flip black strokes/fills when Obsidian uses a dark theme
- **Live preview by default** — show the floating preview automatically in `tikz` blocks

## License

MIT — see [LICENSE](LICENSE).
