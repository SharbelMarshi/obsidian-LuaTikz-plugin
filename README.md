# LuaTikZ

Render `tikz` and `luatikz` code blocks in Obsidian using **local LuaLaTeX** (recommended) or **TikZJax**.

## What it supports

**Dual renderers.** Choose Local LuaLaTeX for full TeX package support, or TikZJax for shell-free rendering with a smaller package set.

**Full LuaLaTeX.** If a package or TikZ library is installed in your TeX distribution, you can use it- load extra TikZ libraries with `\usetikzlibrary{...}`, use pgfplots axes, circuitikz, math mode, and normal LaTeX commands. The default preamble already includes common libraries (`arrows.meta`, `positioning`, `calc`, `shapes`, logic gates, etc.).

**Live preview.** While editing inside a `tikz` block, a floating preview updates as you type. Toggle it from the command palette: *Toggle inline live preview*.

Floating live preview

**Built-in helpers.** Short macros for quick diagrams - `\Circle`, `\Arrow`, `\Rect`, logic gates (`\ANDgate`, `\NOTgate`, …), wires, and basic circuit symbols. Autocomplete inside `tikz` blocks suggests TikZ commands, helpers, and snippets.

**Errors mapped to your note.** LaTeX compile errors are mapped back to the line in your TikZ block (and note line when using live preview).

**Dark mode.** Color inversion so black diagram strokes stay visible on dark themes.

**Export.** Rendered blocks get *Export SVG* and *Copy SVG* buttons on hover (clipboard copy is opt-in in settings).

**RTL and Hebrew.** Use `\he{...}` for Hebrew labels and mixed Hebrew/English diagrams. RTL layout is applied automatically when Hebrew or Arabic is detected.

## Requirements



### Local LuaLaTeX (recommended)

- Desktop Obsidian
- LuaLaTeX
- `pdftocairo` for PDF → SVG (`brew install poppler`)
- Enable **Allow local LuaLaTeX execution** in LuaTikz settings

### TikZJax

- Desktop Obsidian
- No shell or local TeX install required
- Enable **LuaTikZ** under Settings → Community plugins.

## Samples

These diagrams were rendered with LuaTikZ and exported as SVG. Preview files live in `[samples/](samples/)`.

### Anatomy and science


|                |              |
| -------------- | ------------ |
| Heart anatomy  | Eye anatomy  |
| Neural anatomy | Airflow path |




### Circuits and logic


|                   |                   |
| ----------------- | ----------------- |
| Circuit diagram 1 | Circuit diagram 2 |
| Circuit diagram 3 | MOSFET P-channel  |
| Logic gates 1     | Logic gates 2     |




### Math and decision diagrams


|             |                 |
| ----------- | --------------- |
| PDE diagram | Decision matrix |




### Maps and layouts


|              |                |
| ------------ | -------------- |
| Train routes | Isometric city |




## Examples



### Basic diagram with Hebrew

```markdown
```tikz
\begin{tikzpicture}
\Text(0,0,Hello)
\Text(0,-1,\he{שלום עולם})
\Arrow(0,-2,2,-2)
\ANDgate(4,-2,and1)
\end{tikzpicture}
```
```

Reading view renders the block inline. In the editor, place the cursor inside the block for live preview.

The `luatikz` fence alias works the same way:

```markdown
```luatikz
\begin{tikzpicture}
\draw (0,0) circle (1cm);
\end{tikzpicture}
```
```



### pgfplots

```markdown
```tikz
\begin{tikzpicture}
\begin{axis}[width=8cm, height=5cm]
\addplot {sin(deg(x))};
\end{axis}
\end{tikzpicture}
```
```



### Extra TikZ libraries

```markdown
```tikz
\usetikzlibrary{patterns}
\begin{tikzpicture}
\draw[pattern=north east lines] (0,0) rectangle (2,1);
\end{tikzpicture}
```
```

## License

MIT — see [LICENSE](LICENSE).

## TikZJax limitation

TikZJax is a limited renderer. It supports many standard TikZ diagrams and basic PGFPlots, but advanced PGFPlots features such as interpolated 3D surface shading may require Local LuaLaTeX.