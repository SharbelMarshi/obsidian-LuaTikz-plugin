# Basic diagram features

## Background grid

Add a grid directive at the top of the block (stripped before render):

```tikz
% grid=1
\begin{tikzpicture}
...
\end{tikzpicture}
```

The number is the step in cm.

## RTL labels

Use `\he{...}` and `\ar{...}` for RTL text in labels. LuaLaTeX shapes the text properly; TikZJax substitutes a basic fallback.

```tikz
\begin{tikzpicture}
\Text(0,0,LTR text)
\Text(0,-1,\he{טקסט})
\Text(0,-2,\ar{نص})
\end{tikzpicture}
```

## Built-in helpers

Short macros for quick diagrams: `\Circle`, `\Arrow`, `\Rect`, `\TextRTL`, `\ResistorRow`, logic gates (`\ANDgate`, `\NOTgate`, …), wires, and basic circuit symbols. Autocomplete inside `tikz` blocks suggests TikZ commands, snippets, node anchors, and relative coordinates.

