# Scaling diagrams

You can scale entire diagrams with TikZ's standard `scale` option. Lines, coordinates, and (with this plugin) **logic gates and text labels** scale together.

## Basic scaling

```tikz
\begin{tikzpicture}[scale=0.5, transform shape]
\Axis(-1,4,-1,3)
\ANDgate(2,1,g1)
\ORgate(4,1,g2)
\LogicWire(g1.output, g2.input 1)
\end{tikzpicture}
```

## Important: `transform shape`

TikZ **nodes** (including logic gates and `\Text` labels) do not scale with the picture unless you use `transform shape`:

```latex
\begin{tikzpicture}[scale=0.5, transform shape]
```

Add `transform shape` on the `tikzpicture` or `scope` when using `scale`.

## What the plugin fixes for you

Logic gate helpers (`\ANDgate`, `\ORgate`, etc.) and text helpers (`\Text`, `\TextAbove`, …) include `transform shape` on each node. The preamble also sets:

```latex
\tikzset{
  every and gate US/.append style={transform shape},
  every or gate US/.append style={transform shape},
  ...
}
```

So gates scale correctly even if you forget `transform shape` on the picture—but adding it on the `tikzpicture` keeps **all** nodes consistent.

## What scales automatically

| Element | Scales with `[scale=...]`? |
|---------|---------------------------|
| `\draw`, `\Line`, `\Arrow` | Yes |
| `\LogicWire` offsets | Yes (coordinate units) |
| Logic gates | Yes (with plugin helpers) |
| `\Text` / `\he{...}` labels | Yes (with plugin helpers) |
| `\Point` | Partially — uses fixed `1.7pt` (stays visible when zoomed out) |

## Scoped scaling

Scale only part of a diagram:

```tikz
\begin{tikzpicture}
\begin{scope}[scale=0.6, transform shape]
  \ANDgate(0,0,g1)
  \NOTgate(2,0,n1)
\end{scope}
\Text(4,0,Full size label)
\end{tikzpicture}
```

## Autocomplete

Style option `scale=0.8` is available in autocompletion inside `[...]`. See [Commands](commands.md).
