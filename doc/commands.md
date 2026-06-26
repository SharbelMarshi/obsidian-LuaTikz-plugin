# Commands

This document covers **Obsidian palette commands** and the **TikZ/LaTeX commands** available through autocompletion.

---

## Obsidian palette commands

Open the command palette (`Cmd+P` / `Ctrl+P`) and search for **LuaTikZ**.

| Command | Description |
|---------|-------------|
| **LuaTikZ: Toggle inline live preview** | Turns the floating editor preview on or off |

When inline preview is enabled and your cursor is inside an open ` ```tikz ` block, a preview panel appears in the top-right of the editor.

---

## TikZ environment commands

| Command | Autocomplete behavior |
|---------|----------------------|
| `\begin{tikzpicture}` | Inserts full environment; **cursor placed inside** |
| `\end{tikzpicture}` | Closes environment |
| `\begin{axis}` | Inserts pgfplots axis; cursor inside |
| `\end{axis}` | Closes axis |
| `\scope` | Inserts scoped block; cursor inside |
| `\endscope` | Closes scope (via `\scope` snippet structure) |

---

## Drawing & path commands

| Command | Description |
|---------|-------------|
| `\draw` | Draw a path |
| `\fill` | Fill a path |
| `\filldraw` | Fill and stroke |
| `\path` | Define path without drawing |
| `\node` | Place a text/shape node |
| `\coordinate` | Define a named coordinate |
| `\clip` | Clip drawing to a path |
| `\foreach` | Loop snippet with editable body |
| `\tikzset{...}` | Set TikZ styles (cursor in braces) |
| `\usetikzlibrary{...}` | Load a TikZ library (cursor in braces) |

---

## RTL & math commands

| Command | Description |
|---------|-------------|
| `\he{...}` | Hebrew text wrapper (cursor inside braces) |
| `\text{...}` | Text in math mode |
| `\frac{}{}` | Fraction (Tab between numerator/denominator) |
| `\cfrac{}{}` | Continued fraction |
| `\sqrt{}` | Square root |
| `\sum_{}^{}` | Summation with limits |
| `\int_{}^{}` | Integral with limits |
| `\lim_{}` | Limit |
| `\vec{}`, `\hat{}`, `\bar{}` | Accents |

### Greek letters & symbols

Available via autocomplete: `\alpha`, `\beta`, `\gamma`, `\delta`, `\Delta`, `\theta`, `\lambda`, `\mu`, `\pi`, `\sigma`, `\omega`, `\Omega`, `\infty`, `\partial`, `\nabla`, `\cdot`, `\times`, `\pm`, `\leq`, `\geq`, `\neq`, `\approx`.

---

## TikZ style options (in `[...]`)

Autocomplete suggests options when typing inside square brackets or after commas:

| Category | Examples |
|----------|----------|
| Arrows | `->`, `<-`, `<->`, `-Stealth`, `Stealth-Stealth` |
| Line style | `thick`, `very thick`, `thin`, `dashed`, `dotted`, `line width=1pt` |
| Shapes | `circle`, `rectangle`, `ellipse`, `rounded corners` |
| Colors | `draw=black`, `fill=cyan!10`, `fill=blue!20`, `fill=none`, `opacity=0.5` |
| Text | `font=\small`, `align=center`, `anchor=north`, `inner sep=2pt` |
| Transform | `scale=0.8`, `rotate=45`, `xshift=1cm`, `yshift=1cm` |
| Positioning | `below=of`, `right=of`, `above=of`, `left=of` |

---

## TikZ libraries (for `\usetikzlibrary{...}`)

Suggested libraries include:

- `arrows.meta`
- `positioning`
- `calc`
- `shapes`
- `decorations.pathmorphing`
- `shapes.gates.logic.US`
- `matrix`
- `fit`
- `backgrounds`

The default preamble already loads the most common libraries for this plugin.

---

## Simple shape helper commands

All `\Circle`, `\ANDgate`, `\LogicWire`, etc. macros are documented in [Simple shape helpers](simple-shape-helpers.md). They appear in autocompletion when you type `\` inside a TikZ block.

---

## Snippet behavior

Block completions use **CodeMirror snippets**:

- Cursor lands **inside** the block, not after `\end{...}`
- Multi-field snippets (e.g. `\frac{}{}`) use **Tab** to jump between fields
- Snippets only activate inside open `tikz`, `latex`, `lualatex`, or `tex` fenced blocks

See [Autocompletion](autocompletion.md) for details.
