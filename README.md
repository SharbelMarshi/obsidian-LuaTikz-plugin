# LuaTikz Plugin for Obsidian

**LuaTikz** is a local LuaLaTeX-based TikZ renderer for Obsidian. Write TikZ and LaTeX code blocks in your notes and render diagrams on your machine—no external services required. The plugin handles the LaTeX preamble for you, supports right-to-left (RTL) text alongside English and math, and displays crisp SVG output in your vault.

## Features

- **Local LuaLaTeX rendering** — Diagrams are compiled locally with LuaLaTeX. Your TikZ source stays on your computer.
- **TikZ code blocks** — Use fenced `tikz` code blocks in Obsidian. Write only the diagram body; no `\documentclass`, `\usepackage`, or `\begin{document}` needed.
- **RTL support** — Wrap RTL text (for example Hebrew) in `\he{...}` for correct direction and font handling.
- **English and math support** — Mix plain English labels, `\text{...}` inside math mode, and standard `$...$` formulas in the same diagram.
- **SVG output** — Rendered diagrams are embedded as SVG for sharp scaling in notes and exports.
- **Simple syntax / auto wrapper** — The plugin automatically wraps your code in a full LuaLaTeX document with the required TikZ, font, and language packages.
- **Simple shape helpers** — Built-in macros from `simpleShapes.ts` for quick diagrams: circles, lines, arrows, rectangles, axes, text nodes, triangles, logic gates (AND, OR, NOT, NAND, NOR, XOR, XNOR, BUFFER), and wire helpers.
- **Autocompletion** — CodeMirror suggestions from `latexAutocomplete.ts` for TikZ commands (`\draw`, `\node`, `\begin{tikzpicture}`), RTL helpers (`\he{}`), and common math symbols.
- **Live preview** — Optional inline live preview updates diagrams as you edit (toggle from the command palette or plugin settings).

## Basic Usage

Create a `tikz` code block in any Obsidian note. Include only the TikZ picture environment—the plugin adds the rest.

```tikz
\begin{tikzpicture}
\node at (0,0) {Hello};
\node at (0,-1) {\he{שלום עולם}};
\node at (0,-2) {$V_G=\frac{Q}{C}$};
\end{tikzpicture}
```

This example shows three common patterns in one diagram: plain English text, RTL text via `\he{...}`, and a displayed math formula.
