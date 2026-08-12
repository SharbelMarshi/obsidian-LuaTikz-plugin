# Renderers

**LuaLaTeX** runs your full TeX toolchain: extra packages, pgfplots, circuitikz, math mode, and RTL via polyglossia. The default preamble loads common TikZ libraries.

## Fonts and RTL

Fonts resolve through fallback chains guarded by `\IfFontExistsTF`, so a name that is not installed is skipped rather than aborting the compile:

| | Chain |
|---|---|
| Main | TeX Gyre Termes (metrically Times, ships with TeX Live/MiKTeX) |
| Hebrew | Noto Serif Hebrew → David CLM → Frank Ruehl CLM |
| Arabic | Noto Sans Arabic → Geeza Pro → Amiri |

Set your own name in **Settings → Fonts** to put it at the front of a chain. If a whole chain misses, nothing is declared for that script and the diagram still renders.

`polyglossia` and the Hebrew/Arabic font families load **only when the diagram uses them** — `\he{}`, `\ar{}`, `\texthebrew{}`, `\textarabic{}`, or Hebrew/Arabic characters — and per script, so a Hebrew diagram never pulls in the Arabic gloss. `\he` and `\ar` are always defined, falling back to plain text when the script is not loaded.

## Custom preamble

**Settings → Preamble → Custom preamble** replaces the generated preamble outright. **Load current preamble** materializes the managed one for editing; **Reset to default** returns to managed.

In custom mode fonts, polyglossia and `\he`/`\ar` are yours to define. The plugin still appends the coordinate-pick calibration block and `\begin{document}`, injects `\documentclass` and `\usepackage{tikz}` if your text omits them, and neutralizes a stray `\begin{document}`. Note that a custom preamble does not receive preamble improvements from later releases — leave it empty unless you need the control.

`\usepackage` and `\usetikzlibrary` lines you write inside a block are hoisted into that preamble. Since TikZ aborts the whole compile on a name it does not recognise, two cases are rewritten first: package names (`\usetikzlibrary{pgfplots}`, `{circuitikz}`, …) are dropped because the preamble already loads them, and PGFPlots-only libraries (`groupplots`, `polar`, `statistics`, …) are moved to `\usepgfplotslibrary`. The editor flags both so the rewrite is never a surprise.

**TikZJax** renders in-process with no shell. Good for standard TikZ and simple plots. Advanced pgfplots (e.g. interpolated 3D surfaces) and real RTL shaping need LuaLaTeX.
