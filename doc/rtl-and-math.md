# RTL, English & math

LuaTikZ is designed for notes that mix **English**, **Hebrew (RTL)**, and **mathematics** in the same diagram.

## English text

Use plain text in nodes or helper macros:

```tikz
\begin{tikzpicture}
\node at (0,0) {Hello world};
\Text(0,-1,Hello)
\end{tikzpicture}
```

## Hebrew (RTL) text

Wrap Hebrew in `\he{...}`:

```tikz
\begin{tikzpicture}
\node at (0,0) {\he{שלום עולם}};
\Text(0,-1,\he{מתח})
\end{tikzpicture}
```

The plugin preamble configures:

- `polyglossia` with English main language and Hebrew as secondary
- **David CLM** as the Hebrew font (`\hebrewfont`)

If Hebrew renders as empty boxes, install a Hebrew-capable TeX font bundle (MacTeX with Hebrew support, or David CLM).

## Math

Use standard LaTeX math inside nodes:

```tikz
\begin{tikzpicture}
\node at (0,0) {$V_G = \frac{Q}{C}$};
\node at (0,-1) {$\sum_{i=1}^{n} x_i$};
\end{tikzpicture}
```

The preamble loads `amsmath` and `amssymb`.

### Mixed label example

```tikz
\begin{tikzpicture}
\Text(0,0,{$V$})
\Text(1,0,\he{מתח})
\Text(2,0,{$= \SI{5}{V}$})
\end{tikzpicture}
```

> For `\SI` and siunitx, add `\usepackage{siunitx}` manually only if you extend the preamble yourself—the default wrapper does not include siunitx.

## Autocomplete for math

Inside TikZ blocks, autocompletion offers `\frac{}{}`, `\sqrt{}`, Greek letters, and relation symbols. See [Commands](commands.md).

## Tips

1. Keep Hebrew inside `\he{...}` — do not rely on raw Unicode direction alone
2. For long Hebrew labels, prefer `\node[align=right]` or `\TextLeft` / `\TextRight` for placement
3. Math in `\Text` helpers: wrap in `$...$` as shown above
